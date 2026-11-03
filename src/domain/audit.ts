import { createHash } from "node:crypto";
import { canonicalize } from "./hash";

export const AUDIT_GENESIS_HASH = "sha256:" + "0".repeat(64);

export interface AuditPayload {
  seq: number | bigint;
  at: string; // ISO
  actorId: string;
  type: string;
  runId: string | null;
  data: unknown;
  prevHash: string;
}

export function auditHash(payload: AuditPayload): string {
  const material = {
    seq: typeof payload.seq === "bigint" ? Number(payload.seq) : payload.seq,
    at: payload.at,
    actorId: payload.actorId,
    type: payload.type,
    runId: payload.runId,
    data: payload.data,
    prevHash: payload.prevHash,
  };
  return (
    "sha256:" +
    createHash("sha256").update(canonicalize(material), "utf8").digest("hex")
  );
}

export interface AuditRow {
  seq: bigint | number;
  at: Date | string;
  actorId: string;
  type: string;
  runId: string | null;
  data: unknown;
  prevHash: string;
  hash: string;
}

/** Verify hash chain; returns first bad seq or null if intact. */
export function verifyAuditChain(rows: AuditRow[]): number | null {
  let expectedPrev = AUDIT_GENESIS_HASH;
  for (const row of rows) {
    const at = typeof row.at === "string" ? row.at : row.at.toISOString();
    const expected = auditHash({
      seq: row.seq,
      at,
      actorId: row.actorId,
      type: row.type,
      runId: row.runId,
      data: row.data,
      prevHash: row.prevHash,
    });
    if (row.prevHash !== expectedPrev || row.hash !== expected) {
      return typeof row.seq === "bigint" ? Number(row.seq) : row.seq;
    }
    expectedPrev = row.hash;
  }
  return null;
}
