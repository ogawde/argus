import type { Prisma } from "@prisma/client";
import { AUDIT_GENESIS_HASH, auditHash } from "@/domain/audit";

/** Constant key for the audit chain advisory lock (any fixed int works). */
export const AUDIT_LOCK_KEY = 7_340_001;

export interface AuditInput {
  actorId: string;
  type: string;
  runId?: string | null;
  /** Must only contain strings, booleans, null and integers (it gets hashed). */
  data?: Record<string, unknown>;
}

/**
 * Append one audit event. Must be called inside a transaction:
 * the advisory lock keeps the hash chain linear when two writers race.
 */
export async function appendAudit(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<{ seq: number; hash: string }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;

  const last = await tx.auditEvent.findFirst({ orderBy: { seq: "desc" } });
  const prevHash = last?.hash ?? AUDIT_GENESIS_HASH;

  // We need the seq before hashing, so take it from the sequence ourselves.
  const rows = await tx.$queryRaw<{ seq: bigint }[]>`
    SELECT nextval(pg_get_serial_sequence('"AuditEvent"', 'seq')) AS seq
  `;
  const seq = rows[0]!.seq;
  const at = new Date();
  const runId = input.runId ?? null;
  // JSON round trip so the hashed data equals what Postgres will give back
  const data = JSON.parse(JSON.stringify(input.data ?? {})) as Prisma.InputJsonObject;

  const hash = auditHash({
    seq,
    at: at.toISOString(),
    actorId: input.actorId,
    type: input.type,
    runId,
    data,
    prevHash,
  });

  await tx.auditEvent.create({
    data: { seq, at, actorId: input.actorId, type: input.type, runId, data, prevHash, hash },
  });

  return { seq: Number(seq), hash };
}
