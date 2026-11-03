"use server";

import { getEnv } from "@/lib/env";
import { appendAudit } from "@/server/audit";
import { getCurrentActor } from "@/server/auth/demo";
import { prisma } from "@/server/db";
import { fail, ok, type ActionResult } from "@/server/actions/result";

const RESET_COOLDOWN_MS = 60_000;

// globalThis so the timer survives Next dev module reloads
const globalForReset = globalThis as unknown as { lastDemoResetAt?: number };

/**
 * Demo only: wipe runs and everything hanging off them so the demo can start over.
 * Payees and history stay (run `pnpm seed:demo` to rebuild those). The audit log is kept.
 */
export async function resetDemo(): Promise<ActionResult<{ deletedRuns: number }>> {
  if (!getEnv().DEMO_MODE) return fail("NOT_DEMO", "Reset is only available in demo mode.");

  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");

  const last = globalForReset.lastDemoResetAt ?? 0;
  const waitMs = RESET_COOLDOWN_MS - (Date.now() - last);
  if (waitMs > 0) {
    return fail("RATE_LIMITED", `Reset is limited to once a minute. Try again in ${Math.ceil(waitMs / 1000)}s.`);
  }
  globalForReset.lastDemoResetAt = Date.now();

  const deletedRuns = await prisma.$transaction(async (tx) => {
    await tx.payoutItem.deleteMany();
    await tx.applyAttempt.deleteMany();
    await tx.webhookEvent.deleteMany();
    await tx.appliedPlan.deleteMany();
    await tx.approval.deleteMany();
    await tx.disposition.deleteMany();
    await tx.flag.deleteMany();
    await tx.planRevision.deleteMany();
    await tx.analysisCache.deleteMany();
    const runs = await tx.payoutRun.deleteMany();
    await appendAudit(tx, {
      actorId: actor.id,
      type: "DEMO_RESET",
      data: { deletedRuns: runs.count },
    });
    return runs.count;
  });

  return ok({ deletedRuns });
}
