import type { Prisma } from "@prisma/client";
import { planHash } from "@/domain/hash";
import type { Flag, PlanFile } from "@/domain/plan";
import { loadPolicy } from "@/domain/policy";
import { analysisHash, buildAnalysis, runPhase2Rules } from "@/domain/rules/engine";
import { loadBaseline, makeRuleContext } from "@/server/planning/context";

const CLOSING_ACTIONS = ["ACCEPTED", "EXCLUDED"];

/**
 * Analysis is hashed with canonicalize(), which only allows integers.
 * Some rules put decimals (robust z, half-integer medians) or Infinity in evidence,
 * so store those as strings before hashing / saving.
 */
function withSafeEvidence(flags: Flag[]): Flag[] {
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
 * Run the rules for a plan, then store the PlanRevision and its Flag rows.
 * Does NOT touch the run row — the caller updates status / currentPlanHash.
 */
export async function saveRevision(
  tx: Prisma.TransactionClient,
  args: { runId: string; plan: PlanFile; actorId: string; cycleDate: Date },
): Promise<{ hash: string; flagCount: number }> {
  const { runId, plan, actorId, cycleDate } = args;
  const hash = planHash(plan);

  const baseline = await loadBaseline(tx);
  const flags = withSafeEvidence(runPhase2Rules(makeRuleContext(plan, cycleDate, baseline)));
  const analysis = buildAnalysis(hash, flags, loadPolicy().version);

  const revisionData = {
    runId,
    hash,
    parentHash: plan.parentHash,
    planJson: plan as unknown as Prisma.InputJsonValue,
    analysisHash: analysisHash(analysis),
    analysisJson: analysis as unknown as Prisma.InputJsonValue,
    createdById: actorId,
  };
  await tx.planRevision.upsert({
    where: { runId_hash: { runId, hash } },
    create: revisionData,
    update: { analysisHash: revisionData.analysisHash, analysisJson: revisionData.analysisJson },
  });

  await tx.flag.deleteMany({ where: { runId, planHash: hash } });
  await tx.flag.createMany({
    data: flags.map((f) => ({
      runId,
      planHash: hash,
      lineId: f.lineId,
      ruleId: f.ruleId,
      severity: f.severity,
      blocking: f.blocking,
      evidence: f.evidence as unknown as Prisma.InputJsonValue,
    })),
  });

  return { hash, flagCount: flags.length };
}

/** True when a blocking flag on this plan has no ACCEPTED / EXCLUDED disposition. */
export async function hasOpenBlockingFlags(
  tx: Prisma.TransactionClient,
  runId: string,
  hash: string,
): Promise<boolean> {
  const blocking = await tx.flag.findMany({ where: { runId, planHash: hash, blocking: true } });
  if (blocking.length === 0) return false;

  const dispositions = await tx.disposition.findMany({
    where: { runId, action: { in: CLOSING_ACTIONS } },
  });
  const closed = new Set(dispositions.map((d) => `${d.lineId}|${d.ruleId}`));
  return blocking.some((f) => !closed.has(`${f.lineId}|${f.ruleId}`));
}
