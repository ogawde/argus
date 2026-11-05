"use server";

import { z } from "zod";
import { applyExclusions } from "@/domain/plan-builder";
import { PlanFileSchema } from "@/domain/plan";
import { canTransition } from "@/domain/state";
import { appendAudit } from "@/server/audit";
import { getCurrentActor } from "@/server/auth/demo";
import { prisma } from "@/server/db";
import { attachRationales } from "@/server/planning/attach-rationales";
import { collectAllFlags } from "@/server/planning/collect-flags";
import { loadBaseline } from "@/server/planning/context";
import { hasOpenBlockingFlags, saveRevision } from "@/server/planning/save-revision";
import { fail, ok, type ActionResult } from "@/server/actions/result";

const BATCH_LINE_ID = "__BATCH__";

const DispositionInput = z.object({
  runId: z.string().min(1),
  lineId: z.string().min(1),
  ruleId: z.string().min(1),
  action: z.enum(["ACCEPTED", "EXCLUDED"]),
  reason: z.string().trim().min(3, "Give a short reason (3+ characters).").max(500),
});

export type DispositionInput = z.input<typeof DispositionInput>;

/**
 * Accept a flag (just a Disposition row) or exclude its line
 * (new plan revision, rules re-run, flags rebuilt for the new hash).
 */
export async function dispositionFlag(
  input: DispositionInput,
): Promise<ActionResult<{ planHash: string; status: string }>> {
  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");

  const parsed = DispositionInput.safeParse(input);
  if (!parsed.success) return fail("BAD_INPUT", parsed.error.issues[0]!.message);
  const { runId, lineId, ruleId, action, reason } = parsed.data;

  if (action === "EXCLUDED" && lineId === BATCH_LINE_ID) {
    return fail("BAD_INPUT", "A batch-level flag can only be accepted.");
  }

  // For EXCLUDED we need Elastic/ER I/O before the transaction.
  let nextFlags: Awaited<ReturnType<typeof collectAllFlags>> | null = null;
  let nextPlanJson: ReturnType<typeof applyExclusions> | null = null;

  if (action === "EXCLUDED") {
    const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
    if (!run) return fail("NOT_FOUND", "Run not found.");
    if (!run.currentPlanHash) return fail("BAD_STATE", "Run has no plan yet.");
    const revision = await prisma.planRevision.findUnique({
      where: { runId_hash: { runId, hash: run.currentPlanHash } },
    });
    if (!revision) return fail("BAD_STATE", "Current plan revision is missing.");
    const plan = PlanFileSchema.parse(revision.planJson);
    nextPlanJson = applyExclusions(plan, new Set([lineId]), run.currentPlanHash);
    const baseline = await loadBaseline(prisma);
    nextFlags = await collectAllFlags({
      plan: nextPlanJson,
      cycleDate: run.cycleDate,
      baseline,
    });
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const run = await tx.payoutRun.findUnique({ where: { id: runId } });
      if (!run) return fail("NOT_FOUND", "Run not found.");
      if (run.status !== "FLAGGED" && run.status !== "READY") {
        return fail("BAD_STATE", `Cannot change flags while run is ${run.status}.`);
      }
      const currentHash = run.currentPlanHash;
      if (!currentHash) return fail("BAD_STATE", "Run has no plan yet.");

      const flag = await tx.flag.findUnique({
        where: {
          runId_planHash_lineId_ruleId: { runId, planHash: currentHash, lineId, ruleId },
        },
      });
      if (!flag) return fail("NO_SUCH_FLAG", "That flag is not on the current plan.");

      const claimed = await tx.payoutRun.updateMany({
        where: { id: runId, rowVersion: run.rowVersion },
        data: { rowVersion: { increment: 1 } },
      });
      if (claimed.count !== 1) return fail("STALE_STATE", "Someone else changed this run. Reload.");

      await tx.disposition.upsert({
        where: { runId_lineId_ruleId: { runId, lineId, ruleId } },
        create: { runId, lineId, ruleId, action, reason, actorId: actor.id },
        update: { action, reason, actorId: actor.id, at: new Date() },
      });

      let newHash = currentHash;
      if (action === "EXCLUDED" && nextPlanJson && nextFlags) {
        const saved = await saveRevision(tx, {
          runId,
          plan: nextPlanJson,
          actorId: actor.id,
          flags: nextFlags,
        });
        newHash = saved.hash;
      }

      const isFlagged = await hasOpenBlockingFlags(tx, runId, newHash);
      const nextStatus = isFlagged ? "FLAGGED" : "READY";
      const canMove = nextStatus === run.status || canTransition(run.status, nextStatus);
      if (!canMove) throw new Error(`cannot move ${run.status} → ${nextStatus}`);

      await tx.payoutRun.update({
        where: { id: runId },
        data: { status: nextStatus, currentPlanHash: newHash },
      });

      await appendAudit(tx, {
        actorId: actor.id,
        type: action === "EXCLUDED" ? "FLAG_EXCLUDED" : "FLAG_ACCEPTED",
        runId,
        data: { lineId, ruleId, reason, planHash: newHash, status: nextStatus },
      });

      return ok({ planHash: newHash, status: nextStatus });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  if (result.ok && action === "EXCLUDED" && nextFlags) {
    try {
      await attachRationales(runId, result.data.planHash, nextFlags);
    } catch {
      /* optional */
    }
  }

  return result;
}

/** Accept every non-blocking flag on the current plan that has no disposition yet. */
export async function bulkAcceptWarnings(
  runId: string,
  reason = "Bulk accepted warnings",
): Promise<ActionResult<{ accepted: number }>> {
  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");

  const cleanReason = reason.trim() || "Bulk accepted warnings";

  return prisma.$transaction(async (tx) => {
    const run = await tx.payoutRun.findUnique({ where: { id: runId } });
    if (!run) return fail("NOT_FOUND", "Run not found.");
    if (run.status !== "FLAGGED" && run.status !== "READY") {
      return fail("BAD_STATE", `Cannot change flags while run is ${run.status}.`);
    }
    if (!run.currentPlanHash) return fail("BAD_STATE", "Run has no plan yet.");

    const claimed = await tx.payoutRun.updateMany({
      where: { id: runId, rowVersion: run.rowVersion },
      data: { rowVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) return fail("STALE_STATE", "Someone else changed this run. Reload.");

    const warnings = await tx.flag.findMany({
      where: { runId, planHash: run.currentPlanHash, blocking: false },
    });
    const existing = await tx.disposition.findMany({ where: { runId } });
    const done = new Set(existing.map((d) => `${d.lineId}|${d.ruleId}`));
    const todo = warnings.filter((f) => !done.has(`${f.lineId}|${f.ruleId}`));

    if (todo.length > 0) {
      await tx.disposition.createMany({
        data: todo.map((f) => ({
          runId,
          lineId: f.lineId,
          ruleId: f.ruleId,
          action: "ACCEPTED",
          reason: cleanReason,
          actorId: actor.id,
        })),
      });
      await appendAudit(tx, {
        actorId: actor.id,
        type: "WARNINGS_BULK_ACCEPTED",
        runId,
        data: { count: todo.length, reason: cleanReason, planHash: run.currentPlanHash },
      });
    }

    return ok({ accepted: todo.length });
  });
}
