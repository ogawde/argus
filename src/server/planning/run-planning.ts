import type { Prisma } from "@prisma/client";
import { parseCsvText } from "@/domain/csv";
import { buildPlan } from "@/domain/plan-builder";
import { loadPolicy } from "@/domain/policy";
import { appendAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { attachRationales } from "@/server/planning/attach-rationales";
import { collectAllFlags } from "@/server/planning/collect-flags";
import { loadBaseline } from "@/server/planning/context";
import { hasOpenBlockingFlags, saveRevision } from "@/server/planning/save-revision";

export const sourceCacheKey = (runId: string) => `source:${runId}`;

export interface StoredSource {
  filename: string;
  text: string;
}

/**
 * Build the first plan for a run that is already in PLANNING.
 * Phase 2 + Elastic + ER flags; rationales attached after commit.
 */
export async function runPlanning(
  runId: string,
  actorId: string,
): Promise<{ planHash: string; status: "FLAGGED" | "READY" }> {
  const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("run not found");
  if (run.status !== "PLANNING") throw new Error(`run is ${run.status}, not PLANNING`);

  const cached = await prisma.analysisCache.findUnique({ where: { key: sourceCacheKey(runId) } });
  if (!cached) throw new Error("uploaded CSV is missing for this run");
  const source = cached.value as unknown as StoredSource;

  const policy = loadPolicy();
  const parsed = parseCsvText(source.text, policy.csv);
  if (parsed.errors.length > 0) throw new Error("stored CSV no longer parses");

  const baseline = await loadBaseline(prisma);
  const cycleIso = run.cycleDate.toISOString().slice(0, 10);

  const { plan } = buildPlan({
    runId,
    filename: source.filename,
    fileBytes: source.text,
    cycleDate: cycleIso,
    rows: parsed.rows,
    payeesByRef: baseline.payeesByRef,
    payeeMasterVersion: run.payeeMasterVersion,
    historyWatermark: baseline.historyWatermark.toISOString(),
    policyVersion: policy.version,
  });

  const flags = await collectAllFlags({ plan, cycleDate: run.cycleDate, baseline });

  const result = await prisma.$transaction(
    async (tx) => {
      const still = await tx.payoutRun.findUnique({ where: { id: runId } });
      if (!still || still.status !== "PLANNING") throw new Error("run left PLANNING");

      const saved = await saveRevision(tx, {
        runId,
        plan,
        actorId,
        flags,
      });

      const isFlagged = await hasOpenBlockingFlags(tx, runId, saved.hash);
      const status = isFlagged ? "FLAGGED" : "READY";

      const updated = await tx.payoutRun.updateMany({
        where: { id: runId, status: "PLANNING", rowVersion: still.rowVersion },
        data: {
          status,
          currentPlanHash: saved.hash,
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error("run changed while planning");

      await appendAudit(tx, {
        actorId,
        type: "PLAN_CREATED",
        runId,
        data: {
          planHash: saved.hash,
          lineCount: plan.lines.length,
          flagCount: saved.flagCount,
          status,
        } satisfies Record<string, Prisma.InputJsonValue>,
      });

      return { planHash: saved.hash, status: status as "FLAGGED" | "READY" };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  // Advisory LLM after deterministic flags (cached/off/live)
  try {
    await attachRationales(runId, result.planHash, flags);
  } catch {
    // planning still succeeded; UI can show flags without rationales
  }

  return result;
}
