import { loadErWeights } from "@/domain/er-weights";
import type { Flag, PlanFile } from "@/domain/plan";
import { loadPolicy } from "@/domain/policy";
import {
  buildAnalysis,
  runPhase2Rules,
  runPhase3ElasticRules,
} from "@/domain/rules/engine";
import { prisma } from "@/server/db";
import { fetchElasticRuleInputs } from "@/server/elastic/esql";
import { resolveEntityMatches } from "@/server/er/resolve";
import type { Baseline } from "@/server/planning/context";
import { makeRuleContext } from "@/server/planning/context";

/** Deduplicate flags by (lineId, ruleId), first wins. */
export function dedupeFlags(flags: Flag[]): Flag[] {
  const seen = new Set<string>();
  const out: Flag[] = [];
  for (const f of flags) {
    const key = `${f.lineId}|${f.ruleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Analysis hashing only allows safe integers in evidence values.
 * Stringify decimals / Infinity before persist.
 */
export function withSafeEvidence(flags: Flag[]): Flag[] {
  return flags.map((flag) => ({
    ...flag,
    evidence: flag.evidence.map((item) =>
      typeof item.value === "number" && !Number.isSafeInteger(item.value)
        ? { ...item, value: String(item.value) }
        : item,
    ),
  }));
}

/**
 * Full Phase 2 + Phase 3 flag set for a plan.
 * Does Elastic + embedding I/O — call **outside** a Prisma transaction.
 */
export async function collectAllFlags(args: {
  plan: PlanFile;
  cycleDate: Date;
  baseline: Baseline;
}): Promise<Flag[]> {
  const policy = loadPolicy();
  const ctx = makeRuleContext(args.plan, args.cycleDate, args.baseline);
  const liveRuns = await prisma.payoutRun.findMany({
    where: { status: { notIn: ["FAILED", "REJECTED", "DRAFT"] } },
    select: { id: true },
  });
  const others = await prisma.payoutItem.findMany({
    where: { runId: { in: liveRuns.map((r) => r.id) }, payeeId: { not: null } },
    select: { payeeId: true, amountMinor: true, runId: true },
  });
  ctx.otherRunItems = others
    .filter((row) => row.payeeId)
    .map((row) => ({
      payeeId: row.payeeId!,
      amountMinor: row.amountMinor,
      currency: args.plan.currency,
      runId: row.runId,
    }));

  const phase2 = runPhase2Rules(ctx);

  const elasticInputs = await fetchElasticRuleInputs(args.cycleDate, policy);
  const phase3Elastic = runPhase3ElasticRules(ctx, elasticInputs);

  const payees = await prisma.payee.findMany();
  const payeesById = new Map(
    payees.map((p) => [
      p.id,
      {
        id: p.id,
        displayName: p.displayName,
        country: p.country,
        destinationFingerprint: p.destinationFingerprint,
        createdAt: p.createdAt,
        destinationChangedAt: p.destinationChangedAt,
      },
    ]),
  );

  const erFlags = await resolveEntityMatches({
    plan: args.plan,
    cycleDate: args.cycleDate,
    payeesById,
    historyByPayeeId: args.baseline.historyByPayeeId,
    policy,
  });

  return withSafeEvidence(dedupeFlags([...phase2, ...phase3Elastic, ...erFlags]));
}

export function analysisForPlan(planHashValue: string, flags: Flag[]) {
  const policy = loadPolicy();
  const er = loadErWeights();
  const analysis = buildAnalysis(planHashValue, flags, policy.version);
  analysis.engineVersions.erWeights = er.version;
  analysis.engineVersions.esMapping = "payout-history-v1+payee-identities-v1";
  return analysis;
}
