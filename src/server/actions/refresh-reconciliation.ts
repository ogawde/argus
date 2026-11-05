"use server";

import { getEnv } from "@/lib/env";
import { pollReconciliation } from "@/server/apply/poll";
import { getCurrentActor } from "@/server/auth/demo";
import { fail, ok, type ActionResult } from "@/server/actions/result";

/** Pull the latest payout statuses. Used by the reconciliation panel. */
export async function refreshReconciliation(runId: string): Promise<ActionResult<{ polled: true }>> {
  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");
  await pollReconciliation(runId);
  return ok({ polled: true });
}

export async function reconcilePollMs(): Promise<number> {
  return getEnv().RECONCILE_POLL_MS;
}
