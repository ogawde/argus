import { loadErWeights, type ErWeights } from "./er-weights";
import { normalizeEmail, normalizeName } from "./normalize";

/**
 * Entity resolution scoring (ARCHITECTURE §11.5). Pure functions only:
 * no Elasticsearch, no embeddings model. The vector similarity comes in as a number.
 */

export const MATCH_THRESHOLD = 0.85; // CRITICAL, blocking
export const REVIEW_THRESHOLD = 0.65; // WARN, a human looks at it

export type ErBand = "MATCH" | "REVIEW" | "NONE";

export interface ErFeatures {
  vecCos: number; // 0..1 (cosine, clamped)
  nameJW: number; // Jaro-Winkler on normalized names
  nameTokenSort: number; // token-sort ratio
  nameNearIdentical: 0 | 1; // normalized names are at most 1 typo apart (1 edit, or same words reordered)
  emailLocalSim: number; // 1 - levenshtein / maxLen on email local parts
  sameDestination: 0 | 1;
  sameCountry: 0 | 1 | null; // null = unknown
  suffixConflict: 0 | 1; // jr / sr / ii mismatch is a counter-signal
  sameAmountThisCycle: 0 | 1; // context only, never identity evidence
}

export interface ErIdentity {
  name: string;
  email: string;
  country?: string | null;
}

// ---------- string metrics ----------

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1, // delete
        current[j - 1]! + 1, // insert
        previous[j - 1]! + cost, // replace
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** 1 = identical, 0 = nothing in common. */
export function levenshteinSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - levenshtein(a, b) / longest;
}

export function jaro(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (a.length === 0 || b.length === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched: boolean[] = new Array(a.length).fill(false);
  const bMatched: boolean[] = new Array(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(b.length - 1, i + window);
    for (let j = start; j <= end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // count characters that matched but are in a different order
  let outOfOrder = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) outOfOrder++;
    k++;
  }
  const transpositions = outOfOrder / 2;

  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const base = jaro(a, b);
  if (base <= 0.7) return base;

  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;

  return base + prefix * 0.1 * (1 - base);
}

/**
 * Sort the words first, so "doe john" and "john doe" look the same.
 * Also tries the version without spaces ("al rashid" vs "alrashid") and keeps the better one.
 */
export function tokenSortRatio(a: string, b: string): number {
  const sortTokens = (s: string) => s.split(" ").filter(Boolean).sort().join(" ");
  const sorted = levenshteinSimilarity(sortTokens(a), sortTokens(b));
  const compact = levenshteinSimilarity(a.replace(/ /g, ""), b.replace(/ /g, ""));
  return Math.max(sorted, compact);
}

/** Word vs word: Jaro-Winkler, except a single letter that starts the other word counts as an initial ("j" ~ "john"). */
function tokenSimilarity(a: string, b: string): number {
  const isInitial = (short: string, long: string) =>
    short.length === 1 && long.length > 1 && long.startsWith(short);
  if (isInitial(a, b) || isInitial(b, a)) return 0.9;
  return jaroWinkler(a, b);
}

/**
 * Jaro-Winkler on the whole name, or word by word (so reordered names and initials still score well).
 * Takes the better of the two.
 */
export function nameSimilarity(a: string, b: string): number {
  const whole = jaroWinkler(a, b);

  const tokensA = a.split(" ").filter(Boolean);
  const tokensB = b.split(" ").filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return whole;

  // for each word, find its best partner in the other name; average both directions
  const bestAverage = (from: string[], to: string[]) =>
    from.reduce((sum, word) => sum + Math.max(...to.map((other) => tokenSimilarity(word, other))), 0) /
    from.length;
  const wordByWord = (bestAverage(tokensA, tokensB) + bestAverage(tokensB, tokensA)) / 2;

  return Math.max(whole, wordByWord);
}

// ---------- features ----------

/** True when two names are one typo apart, or are the same words in a different order. */
export function isNearIdentical(a: string, b: string): boolean {
  if (a === "" || b === "") return false;
  if (levenshtein(a, b) <= 1) return true;
  const sortTokens = (s: string) => s.split(" ").filter(Boolean).sort().join(" ");
  return sortTokens(a) === sortTokens(b);
}

const GENERATION_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** Only generation markers count as a counter-signal (not Mr / Dr). */
function generationOf(suffix: string | null): string {
  if (!suffix) return "";
  return suffix
    .split(" ")
    .filter((token) => GENERATION_SUFFIXES.has(token))
    .sort()
    .join(" ");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sameCountryOf(a?: string | null, b?: string | null): 0 | 1 | null {
  const left = a?.trim().toUpperCase();
  const right = b?.trim().toUpperCase();
  if (!left || !right) return null;
  return left === right ? 1 : 0;
}

/**
 * Build the feature vector for one pair.
 * `vecCos` is the cosine between the two identity embeddings (any range, we clamp to 0..1).
 */
export function buildErFeatures(
  a: ErIdentity,
  b: ErIdentity,
  extra: { vecCos: number; sameAmountThisCycle?: boolean },
): ErFeatures {
  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);
  const emailA = normalizeEmail(a.email);
  const emailB = normalizeEmail(b.email);

  const hasDestination = emailA.domain !== "" && emailB.domain !== "";
  const sameDestination = hasDestination && emailA.normalized === emailB.normalized;

  return {
    vecCos: clamp01(extra.vecCos),
    nameJW: nameSimilarity(nameA.normalized, nameB.normalized),
    nameTokenSort: tokenSortRatio(nameA.normalized, nameB.normalized),
    nameNearIdentical: isNearIdentical(nameA.normalized, nameB.normalized) ? 1 : 0,
    emailLocalSim: levenshteinSimilarity(emailA.local, emailB.local),
    sameDestination: sameDestination ? 1 : 0,
    sameCountry: sameCountryOf(a.country, b.country),
    suffixConflict: generationOf(nameA.suffix) !== generationOf(nameB.suffix) ? 1 : 0,
    sameAmountThisCycle: extra.sameAmountThisCycle ? 1 : 0,
  };
}

// ---------- scoring ----------

export interface ErScore {
  /** final score after hard caps */
  score: number;
  /** score before hard caps */
  rawScore: number;
  /** which caps were applied, e.g. "suffixConflict" */
  caps: string[];
  band: ErBand;
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Only a known mismatch counts (as a penalty). Same or unknown country says nothing: millions share a country. */
function countryMismatchValue(sameCountry: 0 | 1 | null): number {
  return sameCountry === 0 ? 1 : 0;
}

/** The linear part (before the sigmoid). Handy for the tuner. */
export function linearScore(features: ErFeatures, weights: ErWeights = loadErWeights()): number {
  const w = weights.weights;
  return (
    weights.bias +
    w.vecCos * features.vecCos +
    w.nameJW * features.nameJW +
    w.nameTokenSort * features.nameTokenSort +
    w.nameNearIdentical * features.nameNearIdentical +
    w.emailLocalSim * features.emailLocalSim +
    w.sameDestination * features.sameDestination -
    w.countryMismatchPenalty * countryMismatchValue(features.sameCountry)
  );
}

export function bandFor(score: number): ErBand {
  if (score >= MATCH_THRESHOLD) return "MATCH";
  if (score >= REVIEW_THRESHOLD) return "REVIEW";
  return "NONE";
}

/** score = sigmoid(bias + sum(weight * feature)), then hard caps. sameAmountThisCycle is never used here. */
export function scoreErFeatures(
  features: ErFeatures,
  weights: ErWeights = loadErWeights(),
): ErScore {
  const rawScore = sigmoid(linearScore(features, weights));
  let score = rawScore;
  const caps: string[] = [];

  if (features.suffixConflict === 1 && score > weights.caps.suffixConflictMax) {
    score = weights.caps.suffixConflictMax;
    caps.push("suffixConflict");
  }

  const countryMismatch =
    features.sameCountry === 0 &&
    features.sameDestination === 0 &&
    features.emailLocalSim < weights.caps.countryMismatchEmailSimBelow;
  if (countryMismatch && score > weights.caps.countryMismatchMax) {
    score = weights.caps.countryMismatchMax;
    caps.push("countryMismatch");
  }

  return { score, rawScore, caps, band: bandFor(score) };
}

/** Round for evidence output so the numbers are stable (3 decimals). */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
