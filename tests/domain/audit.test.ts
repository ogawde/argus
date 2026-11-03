import { describe, expect, it } from "vitest";
import { AUDIT_GENESIS_HASH, auditHash, verifyAuditChain, type AuditRow } from "@/domain/audit";

function buildChain(count: number): AuditRow[] {
  const rows: AuditRow[] = [];
  let prevHash = AUDIT_GENESIS_HASH;
  for (let i = 1; i <= count; i++) {
    const base = {
      seq: i,
      at: new Date(Date.UTC(2026, 9, 28, 12, 0, i)).toISOString(),
      actorId: "maya",
      type: "TEST_EVENT",
      runId: "run-1",
      data: { step: i },
      prevHash,
    };
    const hash = auditHash(base);
    rows.push({ ...base, hash });
    prevHash = hash;
  }
  return rows;
}

describe("audit chain", () => {
  it("accepts an untouched chain", () => {
    expect(verifyAuditChain(buildChain(5))).toBeNull();
  });

  it("flags the row whose data was edited", () => {
    const rows = buildChain(5);
    rows[2] = { ...rows[2]!, data: { step: 999 } };
    expect(verifyAuditChain(rows)).toBe(3);
  });

  it("flags a deleted row", () => {
    const rows = buildChain(5);
    rows.splice(1, 1);
    expect(verifyAuditChain(rows)).toBe(3);
  });

  it("flags a bad genesis link", () => {
    const rows = buildChain(2);
    rows[0] = { ...rows[0]!, prevHash: "sha256:" + "1".repeat(64) };
    expect(verifyAuditChain(rows)).toBe(1);
  });
});
