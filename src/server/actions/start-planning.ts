"use server";

import { appendAudit } from "@/server/audit";
import { getCurrentActor } from "@/server/auth/demo";
import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";
import { runPlanning } from "@/server/planning/run-planning";
import { fail, ok, type ActionResult } from "@/server/actions/result";

/** DRAFT → PLANNING (compare-and-set), then plan synchronously. */
export async function startPlanning(
  runId: string,
): Promise<ActionResult<{ planHash: string; status: "FLAGGED" | "READY" }>> {
  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");
  if (actor.role !== "PREPARER") return fail("FORBIDDEN", "Only a preparer can start planning.");

  const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
  if (!run) return fail("NOT_FOUND", "Run not found.");
  if (run.status !== "DRAFT") return fail("BAD_STATE", `Run is ${run.status}, expected DRAFT.`);

  const claimed = await prisma.payoutRun.updateMany({
    where: { id: runId, status: "DRAFT", rowVersion: run.rowVersion },
    data: { status: "PLANNING", rowVersion: { increment: 1 } },
  });
  if (claimed.count !== 1) return fail("STALE_STATE", "Someone else changed this run. Reload.");

  try {
    const result = await runPlanning(runId, actor.id);
    return ok(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "planning failed";
    logger.error("planning failed", { runId, message });
    await prisma.$transaction(async (tx) => {
      await tx.payoutRun.update({
        where: { id: runId },
        data: { status: "FAILED", lastError: { message }, rowVersion: { increment: 1 } },
      });
      await appendAudit(tx, {
        actorId: actor.id,
        type: "PLANNING_FAILED",
        runId,
        data: { message },
      });
    });
    return fail("PLANNING_FAILED", message);
  }
}
