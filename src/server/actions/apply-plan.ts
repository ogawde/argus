"use server";

import { fail, type ActionResult } from "@/server/actions/result";

/** Phase 3: PayPal apply is not built yet. */
export async function applyPlan(runId: string): Promise<ActionResult<never>> {
  void runId;
  return fail("NOT_IMPLEMENTED", "Apply is not implemented yet.");
}
