"use server";

import { executeApply } from "@/server/apply/execute";
import { getCurrentActor } from "@/server/auth/demo";
import { fail, type ActionResult } from "@/server/actions/result";
import type { ApplyOutcome } from "@/server/apply/execute";

/** Idempotent PayPal apply. Second click returns the existing batch — it does not pay twice. */
export async function applyPlan(
  runId: string,
  planHash: string,
  confirmText: string,
): Promise<ActionResult<ApplyOutcome>> {
  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");
  return executeApply({ runId, planHash, confirmText, actor });
}
