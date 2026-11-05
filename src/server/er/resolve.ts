import {
  buildErFeatures,
  round3,
  scoreErFeatures,
  type ErFeatures,
  type ErIdentity,
  type ErScore,
} from "@/domain/er";
import { loadErWeights } from "@/domain/er-weights";
import { identityText, normalizeEmail, normalizeName } from "@/domain/normalize";
import type { Flag, PlanFile, PlanLine } from "@/domain/plan";
import { loadPolicy, type Policy } from "@/domain/policy";
import { daysBetween, includedLines, type HistoricalPayoutView } from "@/domain/rules/types";
import { dot, getEmbeddingProvider, type EmbeddingProvider } from "@/server/embeddings";
import { retrieveCandidates, type ErCandidate, type IdentityQuery } from "./retrieve";

/** The payee master columns ER needs. A Prisma `Payee` row fits this shape. */
export interface ErPayee {
  id: string;
  displayName: string;
  country: string | null;
  destinationFingerprint: string;
  createdAt: Date;
  destinationChangedAt: Date | null;
}

export type RiskReason = "newPayee" | "recentPayee" | "destinationChanged" | "duplicateName";

export interface ResolveEntityMatchesArgs {
  plan: PlanFile;
  cycleDate: Date;
  /** payee master by payee id */
  payeesById: Map<string, ErPayee>;
  historyByPayeeId: Map<string, HistoricalPayoutView[]>;
  policy?: Policy;
  /** tests can pass a fake embedding provider */
  embeddings?: EmbeddingProvider;
  /** tests can replace the Elasticsearch search */
  search?: (query: IdentityQuery) => Promise<ErCandidate[]>;
}

interface RiskyLine {
  line: PlanLine;
  reasons: RiskReason[];
}

/**
 * Which lines should we run entity resolution for? (ARCHITECTURE §11.1)
 * New payee, recently created payee, recently changed destination, or the same name twice in the batch.
 */
export function pickRiskyLines(args: {
  plan: PlanFile;
  cycleDate: Date;
  payeesById: Map<string, ErPayee>;
  recentDays: number;
}): RiskyLine[] {
  const lines = includedLines(args.plan);

  // count how many different payees use each normalized name in this batch
  const refsByName = new Map<string, Set<string>>();
  for (const line of lines) {
    const name = normalizeName(line.displayName).normalized;
    const refs = refsByName.get(name) ?? new Set<string>();
    refs.add(line.payeeRef);
    refsByName.set(name, refs);
  }

  const risky: RiskyLine[] = [];
  for (const line of lines) {
    const reasons: RiskReason[] = [];
    const payee = line.payeeId ? args.payeesById.get(line.payeeId) : undefined;

    if (line.payeeId === null) reasons.push("newPayee");
    if (payee && isRecent(payee.createdAt, args.cycleDate, args.recentDays)) {
      reasons.push("recentPayee");
    }
    if (payee?.destinationChangedAt && isRecent(payee.destinationChangedAt, args.cycleDate, args.recentDays)) {
      reasons.push("destinationChanged");
    }
    const sameNameRefs = refsByName.get(normalizeName(line.displayName).normalized);
    if (sameNameRefs && sameNameRefs.size > 1) reasons.push("duplicateName");

    if (reasons.length > 0) risky.push({ line, reasons });
  }
  return risky;
}

function isRecent(date: Date, cycleDate: Date, recentDays: number): boolean {
  const days = daysBetween(date, cycleDate);
  return days >= 0 && days <= recentDays;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Same text we index in Elasticsearch, so query and documents live in the same vector space. */
function identityTextOf(name: string, email: string, country: string | null): string {
  return identityText({
    nameNormalized: normalizeName(name).normalized,
    emailLocalNormalized: normalizeEmail(email).local,
    country,
  });
}

/** Short human summary of the matched payee, shown in the evidence drawer and given to the LLM. */
function profileSummary(args: {
  candidate: ErCandidate;
  payee: ErPayee | undefined;
  history: HistoricalPayoutView[];
  cycleDate: Date;
}): string {
  const { candidate, payee, history, cycleDate } = args;
  if (candidate.channels.includes("batch") || !payee) {
    return "new payee in this batch, no history";
  }
  const age = daysBetween(payee.createdAt, cycleDate);
  const lastPaid = history.reduce<Date | null>(
    (latest, item) => (latest === null || item.paidAt > latest ? item.paidAt : latest),
    null,
  );
  const lastPaidText = lastPaid ? `last paid ${dateOnly(lastPaid)}` : "never paid";
  return `created ${age} days before cycle, ${history.length} payouts, ${lastPaidText}`;
}

/** Turn the best scored candidate into an ENTITY_MATCH flag. */
function buildFlag(args: {
  line: PlanLine;
  candidate: ErCandidate;
  features: ErFeatures;
  result: ErScore;
  relatedLineIds: string[];
  profile: string;
}): Flag {
  const { line, candidate, features, result, relatedLineIds, profile } = args;
  const isMatch = result.band === "MATCH";

  return {
    lineId: line.lineId,
    ruleId: "ENTITY_MATCH",
    severity: isMatch ? "CRITICAL" : "WARN",
    blocking: isMatch,
    evidence: [
      { key: "er.vector", label: "Vector similarity", value: round3(features.vecCos) },
      { key: "er.fuzzyName", label: "Fuzzy name similarity", value: round3(features.nameJW) },
      { key: "er.emailLocal", label: "Email local-part similarity", value: round3(features.emailLocalSim) },
      { key: "er.sameDestination", label: "Same destination", value: features.sameDestination === 1 },
      { key: "er.context.sameAmount", label: "Same amount this cycle (context)", value: features.sameAmountThisCycle === 1 },
      { key: "er.score", label: "Match score", value: round3(result.score) },
      { key: "er.band", label: "Band", value: result.band },
      { key: "er.matchedPayee", label: "Matched payee", value: `${candidate.nameRaw} (${candidate.payeeId})` },
      { key: "er.matchedProfile", label: "Matched payee profile", value: profile },
      { key: "er.channels", label: "Found by", value: candidate.channels.join("+") },
      { key: "er.weights", label: "Weights version", value: loadErWeights().version },
    ],
    relatedLineIds,
  };
}

/**
 * Entity resolution for a plan: risky lines -> Elasticsearch candidates -> pure scoring -> ENTITY_MATCH flags.
 * Call it from planning next to the Phase 2 rules:
 *   const erFlags = await resolveEntityMatches({ plan, cycleDate, payeesById, historyByPayeeId });
 * It can throw (Elasticsearch down, model failed to load); the caller decides how to handle that.
 */
export async function resolveEntityMatches(args: ResolveEntityMatchesArgs): Promise<Flag[]> {
  const policy = args.policy ?? loadPolicy();
  const embeddings = args.embeddings ?? getEmbeddingProvider();
  const search = args.search ?? ((query: IdentityQuery) => retrieveCandidates(query));
  const lines = includedLines(args.plan);

  const risky = pickRiskyLines({
    plan: args.plan,
    cycleDate: args.cycleDate,
    payeesById: args.payeesById,
    recentDays: policy.er.recentDays,
  });
  if (risky.length === 0) return [];

  // other brand-new payees in the batch are not in Elasticsearch yet, so compare against them directly
  const newPeers = lines.filter((line) => line.payeeId === null);

  // one embedding call for every query line and every peer
  const lineText = (line: PlanLine) =>
    identityTextOf(line.displayName, line.destination.value, countryOf(line, args.payeesById));
  const texts = [...new Set([...risky.map((r) => lineText(r.line)), ...newPeers.map(lineText)])];
  const vectors = await embeddings.embed(texts);
  const vectorByText = new Map(texts.map((text, i) => [text, vectors[i]!]));

  const flags: Flag[] = [];
  const chunkSize = 10; // keep the number of parallel Elasticsearch requests small
  for (let start = 0; start < risky.length; start += chunkSize) {
    const chunk = risky.slice(start, start + chunkSize);
    const chunkFlags = await Promise.all(
      chunk.map((item) => resolveOneLine({ ...args, ...item, policy, embeddings, search, lines, newPeers, vectorByText })),
    );
    for (const flag of chunkFlags) if (flag) flags.push(flag);
  }
  return flags;
}

/** A candidate id is a payee id (from Elasticsearch) or a payee ref (another new payee in the batch). */
function isLineOf(line: PlanLine, candidateId: string): boolean {
  return line.payeeId === candidateId || line.payeeRef === candidateId;
}

function countryOf(line: PlanLine, payeesById: Map<string, ErPayee>): string | null {
  return line.payeeId ? (payeesById.get(line.payeeId)?.country ?? null) : null;
}

async function resolveOneLine(
  args: ResolveEntityMatchesArgs & {
    line: PlanLine;
    reasons: RiskReason[];
    policy: Policy;
    embeddings: EmbeddingProvider;
    search: (query: IdentityQuery) => Promise<ErCandidate[]>;
    lines: PlanLine[];
    newPeers: PlanLine[];
    vectorByText: Map<string, number[]>;
  },
): Promise<Flag | null> {
  const { line, reasons, lines } = args;
  const country = countryOf(line, args.payeesById);
  const name = normalizeName(line.displayName);
  const email = normalizeEmail(line.destination.value);
  const queryText = identityTextOf(line.displayName, line.destination.value, country);
  const queryVector = args.vectorByText.get(queryText)!;
  const queryFingerprint = line.payeeId ? (args.payeesById.get(line.payeeId)?.destinationFingerprint ?? "") : "";

  // 1) Elasticsearch candidates (three channels, already unioned)
  const found = await args.search({
    payeeId: line.payeeId,
    nameNormalized: name.normalized,
    emailLocalNormalized: email.local,
    destinationFingerprint: queryFingerprint,
    embedding: queryVector,
  });

  // 2) other new payees in this batch
  const peers: ErCandidate[] = args.newPeers
    .filter((peer) => peer.payeeRef !== line.payeeRef)
    .map((peer) => {
      const peerEmail = normalizeEmail(peer.destination.value);
      const peerText = identityTextOf(peer.displayName, peer.destination.value, null);
      return {
        payeeId: peer.payeeRef,
        nameRaw: peer.displayName,
        nameNormalized: normalizeName(peer.displayName).normalized,
        emailNormalized: peerEmail.normalized,
        emailLocalNormalized: peerEmail.local,
        destinationFingerprint: "",
        country: null,
        identityText: peerText,
        vectorCos: dot(queryVector, args.vectorByText.get(peerText)!),
        channels: ["batch" as const],
      };
    });

  const candidates = [...found, ...peers].filter((c) => c.payeeId !== line.payeeId);

  // candidates that only came from a lexical channel have no cosine yet: embed their identity text
  const needVector = candidates.filter((c) => c.vectorCos === null && c.identityText);
  if (needVector.length > 0) {
    const vectors = await args.embeddings.embed(needVector.map((c) => c.identityText));
    needVector.forEach((candidate, i) => {
      candidate.vectorCos = dot(queryVector, vectors[i]!);
    });
  }

  // 3) score every candidate, keep the best one
  const me: ErIdentity = { name: line.displayName, email: line.destination.value, country };
  let best: { candidate: ErCandidate; features: ErFeatures; result: ErScore } | null = null;

  for (const candidate of candidates) {
    // two long-established payees with the same name are not an ER problem (SHARED_DESTINATION covers shared inboxes)
    const onlyDuplicateName = reasons.length === 1 && reasons[0] === "duplicateName";
    if (onlyDuplicateName && candidate.destinationFingerprint !== queryFingerprint) continue;

    const candidateIdentity: ErIdentity = {
      name: candidate.nameRaw || candidate.nameNormalized,
      email: candidate.emailNormalized,
      country: candidate.country,
    };
    const sameAmount = lines.some(
      (batchLine) =>
        batchLine.lineId !== line.lineId &&
        isLineOf(batchLine, candidate.payeeId) &&
        batchLine.amount.minor === line.amount.minor &&
        batchLine.amount.currency === line.amount.currency,
    );
    const features = buildErFeatures(me, candidateIdentity, {
      vecCos: candidate.vectorCos ?? 0,
      sameAmountThisCycle: sameAmount,
    });
    const result = scoreErFeatures(features);
    if (!best || result.score > best.result.score) best = { candidate, features, result };
  }

  if (!best || best.result.band === "NONE") return null;

  const relatedLineIds = lines
    .filter((batchLine) => batchLine.lineId !== line.lineId && isLineOf(batchLine, best.candidate.payeeId))
    .map((batchLine) => batchLine.lineId);

  return buildFlag({
    line,
    candidate: best.candidate,
    features: best.features,
    result: best.result,
    relatedLineIds,
    profile: profileSummary({
      candidate: best.candidate,
      payee: args.payeesById.get(best.candidate.payeeId),
      history: args.historyByPayeeId.get(best.candidate.payeeId) ?? [],
      cycleDate: args.cycleDate,
    }),
  });
}
