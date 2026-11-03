import { describe, expect, it } from "vitest";
import type { CsvRowOk } from "@/domain/csv";
import { planHash } from "@/domain/hash";
import { buildPlan } from "@/domain/plan-builder";
import { loadPolicy } from "@/domain/policy";
import { runPhase2Rules } from "@/domain/rules/engine";
import type { PayeeView, RuleContext } from "@/domain/rules/types";

const cycleDate = new Date("2026-10-28T00:00:00.000Z");

function row(rowNumber: number, payeeRef: string, amountMinor = 1500): CsvRowOk {
  return {
    ok: true,
    rowNumber,
    payeeRef,
    name: `Name ${payeeRef}`,
    email: `${payeeRef.toLowerCase()}@example.com`,
    amountMinor,
    currency: "USD",
    note: "",
  };
}

function makeContext(rows: CsvRowOk[], knownRefs: string[]): RuleContext {
  const payeesByRef = new Map(
    knownRefs.map((ref) => [
      ref,
      { id: ref, displayName: `Name ${ref}`, destinationValue: `${ref.toLowerCase()}@example.com` },
    ]),
  );
  const { plan } = buildPlan({
    runId: "run-1",
    filename: "batch.csv",
    fileBytes: "x",
    cycleDate: "2026-10-28",
    rows,
    payeesByRef,
    payeeMasterVersion: 1,
    historyWatermark: "2026-09-30T00:00:00.000Z",
    policyVersion: "policy.v1",
  });
  return {
    plan,
    policy: loadPolicy(),
    cycleDate,
    historyByPayeeId: new Map(),
    payeeByRef: new Map<string, PayeeView>(),
    priorBatchTotalsMinor: [],
  };
}

describe("DUPLICATE_IN_BATCH", () => {
  it("flags only the second identical row", () => {
    const ctx = makeContext([row(2, "P-1"), row(3, "P-2"), row(4, "P-1")], ["P-1", "P-2"]);
    const flags = runPhase2Rules(ctx).filter((f) => f.ruleId === "DUPLICATE_IN_BATCH");

    expect(flags).toHaveLength(1);
    const secondLine = ctx.plan.lines.find((l) => l.sourceRow === 4)!;
    const firstLine = ctx.plan.lines.find((l) => l.sourceRow === 2)!;
    expect(flags[0]!.lineId).toBe(secondLine.lineId);
    expect(flags[0]!.relatedLineIds).toEqual([firstLine.lineId]);
    expect(flags[0]!.blocking).toBe(true);
  });

  it("does not flag the same payee with a different amount", () => {
    const ctx = makeContext([row(2, "P-1", 1500), row(3, "P-1", 1600)], ["P-1"]);
    const flags = runPhase2Rules(ctx).filter((f) => f.ruleId === "DUPLICATE_IN_BATCH");
    expect(flags).toHaveLength(0);
  });
});

describe("NEW_PAYEE", () => {
  it("flags a payee that is not in the master list", () => {
    const ctx = makeContext([row(2, "P-1"), row(3, "P-NEW")], ["P-1"]);
    const flags = runPhase2Rules(ctx).filter((f) => f.ruleId === "NEW_PAYEE");

    expect(flags).toHaveLength(1);
    const newLine = ctx.plan.lines.find((l) => l.payeeRef === "P-NEW")!;
    expect(flags[0]!.lineId).toBe(newLine.lineId);
    expect(flags[0]!.severity).toBe("WARN");
    expect(flags[0]!.blocking).toBe(false);
  });

  it("escalates a new payee with a much bigger amount to a blocking flag", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => row(i + 2, `P-${i}`, 1500)),
      row(30, "P-NEW", 30000),
    ];
    const ctx = makeContext(rows, rows.slice(0, 20).map((r) => r.payeeRef));
    const flag = runPhase2Rules(ctx).find((f) => f.ruleId === "NEW_PAYEE")!;
    expect(flag.severity).toBe("CRITICAL");
    expect(flag.blocking).toBe(true);
  });
});

describe("plan hash with buildPlan", () => {
  it("does not change when CSV rows are shuffled", () => {
    const rows = [row(2, "P-1"), row(3, "P-2"), row(4, "P-3", 2000)];
    const shuffled = [rows[2]!, rows[0]!, rows[1]!].map((r, i) => ({ ...r, rowNumber: i + 2 }));
    const a = makeContext(rows, ["P-1", "P-2", "P-3"]).plan;
    const b = makeContext(shuffled, ["P-1", "P-2", "P-3"]).plan;
    expect(planHash(a)).toBe(planHash(b));
  });
});
