import type { Prisma } from "@prisma/client";
import { planHash } from "@/domain/hash";
import type { Flag, PlanFile } from "@/domain/plan";
import { analysisHash } from "@/domain/rules/engine";
import { analysisForPlan } from "@/server/planning/collect-flags";

const CLOSING_ACTIONS = ["ACCEPTED", "EXCLUDED"];

/**
 * Persist a PlanRevision + Flag rows for an already-computed flag list.
 * Does NOT touch the run row — the caller updates status / currentPlanHash.
 */
export async function saveRevision(
  tx: Prisma.TransactionClient,
  args: {
    runId: string;
    plan: PlanFile;
    actorId: string;
    flags: Flag[];
  },
): Promise<{ hash: string; flagCount: number }> {
  const { runId, plan, actorId, flags } = args;
  const hash = planHash(plan);
  const analysis = analysisForPlan(hash, flags);

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
    update: {
      analysisHash: revisionData.analysisHash,
      analysisJson: revisionData.analysisJson,
      planJson: revisionData.planJson,
      parentHash: revisionData.parentHash,
    },
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
