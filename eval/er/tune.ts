import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MATCH_THRESHOLD,
  REVIEW_THRESHOLD,
  scoreErFeatures,
  type ErFeatures,
} from "../../src/domain/er";
import { loadErWeights, type ErWeights } from "../../src/domain/er-weights";
import { computePairFeatures, loadLabeledPairs, type PairWithFeatures } from "./shared";

/**
 * Fits the ER weights in two steps:
 *   1. logistic regression (Newton steps, small L2) on the labeled pairs -> a good ranking
 *   2. a straight-line rescale of the logit so the fixed thresholds (REVIEW 0.65, MATCH 0.85)
 *      land where precision >= 0.96 (MATCH) and recall >= 0.88 (REVIEW) on the fitted data.
 * Hard caps are not part of the fit; pairs that hit a cap can never reach REVIEW (caps are < 0.65).
 *
 *   pnpm er:tune            -> prints the fit and a hold-out check
 *   pnpm er:tune -- --write -> also writes src/domain/er-weights.v1.json
 */

const NAMES = [
  "vecCos",
  "nameJW",
  "nameTokenSort",
  "nameNearIdentical",
  "emailLocalSim",
  "sameDestination",
  "sameCountry",
] as const;

const NEGATIVE_CLASS_WEIGHT = 2; // false alarms hurt more than misses
const L2 = 0.01;
const TARGET_MATCH_PRECISION = 0.96; // a little above the 0.95 target, as a safety margin
const TARGET_REVIEW_RECALL = 0.88; // a little above the 0.85 target

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** x[0] is always 1 (the bias). */
function toVector(features: ErFeatures): number[] {
  // a known country mismatch counts as -1 (the fitted weight is then the penalty size)
  const country = features.sameCountry === 0 ? -1 : 0;
  return [
    1,
    features.vecCos,
    features.nameJW,
    features.nameTokenSort,
    features.nameNearIdentical,
    features.emailLocalSim,
    features.sameDestination,
    country,
  ];
}

/** Solve A x = b with Gaussian elimination (tiny matrices only). */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k++) m[row]![k]! -= factor * m[col]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/**
 * Step 1: logistic regression. Returns [bias, ...weights].
 * Evidence should never count against a match, so a feature whose weight comes out negative is
 * switched off (weight 0) and the fit is repeated.
 */
function fitLogistic(items: PairWithFeatures[]): number[] {
  const off = new Set<number>();
  for (let round = 0; round < NAMES.length; round++) {
    const w = fitLogisticWithout(items, off);
    const negative = w.findIndex((value, i) => i > 0 && value < 0);
    if (negative === -1) return w;
    off.add(negative);
  }
  return fitLogisticWithout(items, off);
}

function fitLogisticWithout(items: PairWithFeatures[], off: Set<number>): number[] {
  const rows = items.map((item) => ({
    x: toVector(item.features).map((value, i) => (off.has(i) ? 0 : value)),
    y: item.label === "match" ? 1 : 0,
  }));
  const size = rows[0]!.x.length;
  let w: number[] = new Array(size).fill(0);

  for (let iteration = 0; iteration < 50; iteration++) {
    const gradient: number[] = new Array(size).fill(0);
    const hessian = Array.from({ length: size }, () => new Array(size).fill(0) as number[]);
    for (const { x, y } of rows) {
      const p = sigmoid(x.reduce((sum, value, i) => sum + value * w[i]!, 0));
      const sampleWeight = y === 1 ? 1 : NEGATIVE_CLASS_WEIGHT;
      for (let i = 0; i < size; i++) {
        gradient[i]! += sampleWeight * (p - y) * x[i]!;
        for (let j = 0; j < size; j++) {
          hessian[i]![j]! += sampleWeight * p * (1 - p) * x[i]! * x[j]!;
        }
      }
    }
    for (let i = 1; i < size; i++) {
      gradient[i]! += L2 * w[i]!;
      hessian[i]![i]! += L2 + (off.has(i) ? 1 : 0); // switched-off features stay at 0
    }
    const step = solve(hessian, gradient);
    w = w.map((value, i) => value - step[i]!);
  }
  return w;
}

function zOf(w: number[], features: ErFeatures): number {
  return toVector(features).reduce((sum, value, i) => sum + value * w[i]!, 0);
}

function wouldBeCapped(features: ErFeatures, caps: ErWeights["caps"]): boolean {
  if (features.suffixConflict === 1) return true;
  return (
    features.sameCountry === 0 &&
    features.sameDestination === 0 &&
    features.emailLocalSim < caps.countryMismatchEmailSimBelow
  );
}

/** Step 2: pick two cut points on the logit and rescale so they become the fixed thresholds. */
function calibrate(
  w: number[],
  items: PairWithFeatures[],
  caps: ErWeights["caps"],
): { weights: number[]; matchCut: number; reviewCut: number } {
  const ranked = items
    .map((item) => ({
      z: wouldBeCapped(item.features, caps) ? -Infinity : zOf(w, item.features),
      isMatch: item.label === "match",
    }))
    .sort((a, b) => b.z - a.z);
  const positives = ranked.filter((r) => r.isMatch).length;

  // lowest cut where the top-of-list precision is still >= target
  let matchCut = ranked[0]!.z;
  let hits = 0;
  ranked.forEach((r, i) => {
    if (r.isMatch) hits++;
    if (hits / (i + 1) >= TARGET_MATCH_PRECISION && Number.isFinite(r.z)) matchCut = r.z;
  });

  // highest cut that still reaches the recall target
  let reviewCut = -Infinity;
  hits = 0;
  for (const r of ranked) {
    if (r.isMatch) hits++;
    if (hits / positives >= TARGET_REVIEW_RECALL) {
      reviewCut = r.z;
      break;
    }
  }
  if (!Number.isFinite(reviewCut)) reviewCut = matchCut - 1;

  // BRIEF §9 anchors: the hero pair must be MATCH, the borderline pair must stay in REVIEW
  const s1 = anchorZ(w, items, "pos-001");
  const s9 = anchorZ(w, items, "pos-025");
  if (s1 !== null) matchCut = Math.min(matchCut, s1 - 0.02);
  if (s9 !== null) reviewCut = Math.min(reviewCut, s9 - 0.02);
  if (s1 !== null && s9 !== null && s9 >= matchCut) {
    // S9 must stay below MATCH: move the MATCH cut between S9 and S1
    matchCut = s1 > s9 ? (s1 + s9) / 2 : s9 + 0.02;
  }

  // z' = scale * (z - matchCut) + logit(MATCH)  ->  matchCut maps to 0.85, reviewCut to 0.65
  const gap = Math.max(matchCut - reviewCut, 0.25);
  const scale = (logit(MATCH_THRESHOLD) - logit(REVIEW_THRESHOLD)) / gap;
  const rescaled = w.map((value, i) => (i === 0 ? scale * (value - matchCut) + logit(MATCH_THRESHOLD) : scale * value));
  return { weights: rescaled, matchCut, reviewCut };
}

/** z of one named pair (S1 = pos-001, S9 = pos-025), or null if it is not in the set. */
function anchorZ(w: number[], items: PairWithFeatures[], id: string): number | null {
  const pair = items.find((item) => item.id === id);
  return pair ? zOf(w, pair.features) : null;
}

function toErWeights(base: ErWeights, w: number[]): ErWeights {
  const round = (value: number) => Math.round(value * 100) / 100;
  const [bias, vecCos, nameJW, nameTokenSort, nameNearIdentical, emailLocalSim, sameDestination, mismatch] =
    w.map(round) as [number, number, number, number, number, number, number, number];
  return {
    ...base,
    bias,
    weights: {
      vecCos,
      nameJW,
      nameTokenSort,
      nameNearIdentical,
      emailLocalSim,
      sameDestination,
      countryMismatchPenalty: mismatch, // fitted on a -1 feature, so a positive weight is a penalty
    },
  };
}

function report(label: string, items: PairWithFeatures[], weights: ErWeights): void {
  const count = (threshold: number) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const item of items) {
      const predicted = scoreErFeatures(item.features, weights).score >= threshold;
      const actual = item.label === "match";
      if (predicted && actual) tp++;
      else if (predicted) fp++;
      else if (actual) fn++;
    }
    return { precision: tp + fp === 0 ? 1 : tp / (tp + fp), recall: tp / (tp + fn), fp, fn };
  };
  const match = count(MATCH_THRESHOLD);
  const review = count(REVIEW_THRESHOLD);
  console.log(
    `${label.padEnd(14)} precision@MATCH ${(match.precision * 100).toFixed(1)}% (fp ${match.fp})   recall@REVIEW ${(review.recall * 100).toFixed(1)}% (fn ${review.fn})`,
  );
}

function fitAndCalibrate(items: PairWithFeatures[], base: ErWeights): ErWeights {
  const fitted = fitLogistic(items);
  const { weights } = calibrate(fitted, items, base.caps);
  return toErWeights(base, weights);
}

async function main() {
  const pairs = await computePairFeatures(loadLabeledPairs());
  const base = loadErWeights();

  console.log(`weights in repo (${base.version}):`);
  report("  all pairs", pairs, base);

  // hold-out check: fit on every second pair, test on the others
  const train = pairs.filter((_, i) => i % 2 === 0);
  const test = pairs.filter((_, i) => i % 2 === 1);
  const holdout = fitAndCalibrate(train, base);
  console.log("hold-out check (fit on half, test on the other half):");
  report("  train half", train, holdout);
  report("  test half", test, holdout);

  const final = fitAndCalibrate(pairs, base);
  console.log("fit on all pairs:");
  report("  all pairs", pairs, final);
  for (const id of ["pos-001", "pos-025"]) {
    const pair = pairs.find((p) => p.id === id);
    if (pair) {
      const result = scoreErFeatures(pair.features, final);
      console.log(`  ${id} (${pair.a.name} / ${pair.b.name}) score ${result.score.toFixed(3)} ${result.band}`);
    }
  }
  console.log(JSON.stringify({ bias: final.bias, weights: final.weights }, null, 2));

  if (process.argv.includes("--write")) {
    const file = path.join(process.cwd(), "src", "domain", "er-weights.v1.json");
    const current = JSON.parse(readFileSync(file, "utf8")) as ErWeights;
    const next = { ...current, bias: final.bias, weights: final.weights };
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
