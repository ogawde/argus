"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approvePlan, rejectRun, revokeApproval } from "@/server/actions/approval";
import { createRun } from "@/server/actions/create-run";
import { bulkAcceptWarnings, dispositionFlag } from "@/server/actions/disposition";
import { switchPersona } from "@/server/actions/persona";
import { resetDemo } from "@/server/actions/reset-demo";
import type { ActionResult } from "@/server/actions/result";
import { startPlanning } from "@/server/actions/start-planning";

/**
 * Thin wrappers so plain <form action={...}> works in the pages.
 * They call the real actions, then redirect back (with ?error=... on failure).
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function finish(path: string, result: ActionResult<unknown>): never {
  revalidatePath("/");
  revalidatePath(path);
  if (!result.ok) {
    redirect(`${path}?error=${encodeURIComponent(`${result.code}: ${result.message}`)}`);
  }
  redirect(path);
}

export async function switchPersonaForm(formData: FormData) {
  await switchPersona(text(formData, "personaId"));
  revalidatePath("/", "layout");
}

export async function createRunForm(formData: FormData) {
  const result = await createRun(formData);
  if (!result.ok) finish("/runs/new", result);
  else finish(`/runs/${result.data.runId}`, result);
}

export async function startPlanningForm(formData: FormData) {
  const runId = text(formData, "runId");
  finish(`/runs/${runId}`, await startPlanning(runId));
}

export async function dispositionForm(formData: FormData) {
  const runId = text(formData, "runId");
  const action = text(formData, "action") === "EXCLUDED" ? "EXCLUDED" : "ACCEPTED";
  const result = await dispositionFlag({
    runId,
    lineId: text(formData, "lineId"),
    ruleId: text(formData, "ruleId"),
    action,
    reason: text(formData, "reason"),
  });
  finish(`/runs/${runId}`, result);
}

export async function bulkAcceptForm(formData: FormData) {
  const runId = text(formData, "runId");
  finish(`/runs/${runId}`, await bulkAcceptWarnings(runId, text(formData, "reason")));
}

export async function approveForm(formData: FormData) {
  const runId = text(formData, "runId");
  finish(`/runs/${runId}`, await approvePlan(runId, text(formData, "planHash")));
}

export async function revokeForm(formData: FormData) {
  const runId = text(formData, "runId");
  finish(`/runs/${runId}`, await revokeApproval(runId));
}

export async function rejectForm(formData: FormData) {
  const runId = text(formData, "runId");
  finish(`/runs/${runId}`, await rejectRun(runId, text(formData, "reason")));
}

export async function resetDemoForm() {
  finish("/", await resetDemo());
}
