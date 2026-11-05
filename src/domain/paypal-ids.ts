import { createHash } from "node:crypto";

/** Deterministic PayPal batch id (35 chars). Same run+plan always retries the same id. */
export function senderBatchId(runId: string, planHash: string): string {
  const hex = createHash("sha256").update(`${runId}:${planHash}`, "utf8").digest("hex").slice(0, 32);
  return `ar_${hex}`;
}

/** Deterministic item id (~26 chars) derived from the batch id + line id. */
export function senderItemId(batchId: string, lineId: string): string {
  return `${batchId.slice(3, 15)}_${lineId}`;
}

/** Typed confirm phrase: "APPLY " + first 8 hex chars of the plan hash. */
export function applyConfirmText(planHash: string): string {
  const hex = planHash.replace(/^sha256:/, "");
  return `APPLY ${hex.slice(0, 8)}`;
}
