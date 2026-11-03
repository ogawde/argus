import type { Prisma } from "@prisma/client";
import { parseCsvText } from "@/domain/csv";
import { buildPlan } from "@/domain/plan-builder";
import { loadPolicy } from "@/domain/policy";
import { appendAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { loadBaseline } from "@/server/planning/context";
import { hasOpenBlockingFlags, saveRevision } from "@/server/planning/save-revision";

export const sourceCacheKey = (runId: string) => `source:${runId}`;

export interface StoredSource {
  filename: string;
  text: string;
}

/**
 * Build the first plan for a run that is already in PLANNING.
 * Reads the CSV saved by createRun, runs the Phase 2 rules, stores everything,
 * and moves the run to FLAGGED or READY. Throws on unexpected problems.
 */
export async function runPlanning(
  runId: string,
  actorId: string,
): Promise<{ planHash: string; status: "FLAGGED" | "READY" }> {
  return prisma.$transaction(
    async (tx) => {
      const run = await tx.payoutRun.findUnique({ where: { id: runId } });
      if (!run) throw new Error("run not found");
      if (run.status !== "PLANNING") throw new Error(`run is ${run.status}, not PLANNING`);

      const cached = await tx.analysisCache.findUnique({ where: { key: sourceCacheKey(runId) } });
      if (!cached) throw new Error("uploaded CSV is missing for this run");
      const source = cached.value as unknown as StoredSource;

      const policy = loadPolicy();
      const parsed = parseCsvText(source.text, policy.csv);
      if (parsed.errors.length > 0) throw new Error("stored CSV no longer parses");

      const baseline = await loadBaseline(tx);
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

      const saved = await saveRevision(tx, {
        runId,
        plan,
        actorId,
        cycleDate: run.cycleDate,
      });

      const isFlagged = await hasOpenBlockingFlags(tx, runId, saved.hash);
      const status = isFlagged ? "FLAGGED" : "READY";

      const updated = await tx.payoutRun.updateMany({
        where: { id: runId, status: "PLANNING", rowVersion: run.rowVersion },
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

      return { planHash: saved.hash, status };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
