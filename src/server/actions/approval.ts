"use server";

import { z } from "zod";
import { canTransition, type RunStatus } from "@/domain/state";
import { appendAudit } from "@/server/audit";
import { getCurrentActor } from "@/server/auth/demo";
import { prisma } from "@/server/db";
import { hasOpenBlockingFlags } from "@/server/planning/save-revision";
import { fail, ok, type ActionResult } from "@/server/actions/result";

/** Approver signs off on exactly this plan hash. Preparer cannot approve their own run. */
export async function approvePlan(
  runId: string,
  planHash: string,
): Promise<ActionResult<{ planHash: string }>> {
  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");
  if (actor.role !== "APPROVER") return fail("FORBIDDEN", "Only an approver can approve.");

  return prisma.$transaction(async (tx) => {
    const run = await tx.payoutRun.findUnique({ where: { id: runId } });
    if (!run) return fail("NOT_FOUND", "Run not found.");
    if (run.preparedById === actor.id) {
      return fail("SELF_APPROVAL", "You prepared this run, so someone else must approve it.");
    }
    if (run.status !== "READY") return fail("BAD_STATE", `Run is ${run.status}, expected READY.`);
    if (!run.currentPlanHash || run.currentPlanHash !== planHash) {
      return fail("HASH_MISMATCH", "The plan changed since you opened it. Reload.");
    }

    const revision = await tx.planRevision.findUnique({
      where: { runId_hash: { runId, hash: planHash } },
    });
    if (!revision?.analysisHash) return fail("BAD_STATE", "Plan has no stored analysis.");

    if (await hasOpenBlockingFlags(tx, runId, planHash)) {
      return fail("OPEN_FLAGS", "There are blocking flags without a disposition.");
    }

    const claimed = await tx.payoutRun.updateMany({
      where: { id: runId, status: "READY", rowVersion: run.rowVersion, currentPlanHash: planHash },
      data: { status: "APPROVED", rowVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) return fail("STALE_STATE", "Someone else changed this run. Reload.");

    await tx.approval.create({
      data: { runId, planHash, analysisHash: revision.analysisHash, approverId: actor.id },
    });
    await appendAudit(tx, {
      actorId: actor.id,
      type: "PLAN_APPROVED",
      runId,
      data: { planHash, analysisHash: revision.analysisHash },
    });

    return ok({ planHash });
  });
}

/** Take back an approval: APPROVED → READY. */
export async function revokeApproval(runId: string): Promise<ActionResult> {
  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");
  if (actor.role !== "APPROVER") return fail("FORBIDDEN", "Only an approver can revoke.");

  return prisma.$transaction(async (tx) => {
    const run = await tx.payoutRun.findUnique({ where: { id: runId } });
    if (!run) return fail("NOT_FOUND", "Run not found.");
    if (run.status !== "APPROVED") {
      return fail("BAD_STATE", `Run is ${run.status}, expected APPROVED.`);
    }

    const claimed = await tx.payoutRun.updateMany({
      where: { id: runId, status: "APPROVED", rowVersion: run.rowVersion },
      data: { status: "READY", rowVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) return fail("STALE_STATE", "Someone else changed this run. Reload.");

    await tx.approval.deleteMany({ where: { runId } });
    await appendAudit(tx, {
      actorId: actor.id,
      type: "APPROVAL_REVOKED",
      runId,
      data: { planHash: run.currentPlanHash },
    });

    return ok(null);
  });
}

const RejectReason = z.string().trim().min(3, "Give a short reason (3+ characters).").max(500);

/** Reject a run that has not been applied. Terminal. */
export async function rejectRun(runId: string, reason: string): Promise<ActionResult> {
  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");

  const cleanReason = RejectReason.safeParse(reason);
  if (!cleanReason.success) return fail("BAD_INPUT", cleanReason.error.issues[0]!.message);

  return prisma.$transaction(async (tx) => {
    const run = await tx.payoutRun.findUnique({ where: { id: runId } });
    if (!run) return fail("NOT_FOUND", "Run not found.");
    if (!canTransition(run.status as RunStatus, "REJECTED")) {
      return fail("BAD_STATE", `A ${run.status} run cannot be rejected.`);
    }

    const claimed = await tx.payoutRun.updateMany({
      where: { id: runId, status: run.status, rowVersion: run.rowVersion },
      data: { status: "REJECTED", rowVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) return fail("STALE_STATE", "Someone else changed this run. Reload.");

    await tx.approval.deleteMany({ where: { runId } });
    await appendAudit(tx, {
      actorId: actor.id,
      type: "RUN_REJECTED",
      runId,
      data: { reason: cleanReason.data, fromStatus: run.status },
    });

    return ok(null);
  });
}
