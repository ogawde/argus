import { describe, expect, it } from "vitest";
import { canonicalize, planHash } from "@/domain/hash";
import { makeLineId, type PlanFile } from "@/domain/plan";

function samplePlan(overrides: Partial<PlanFile> = {}): PlanFile {
  const lineA = {
    lineId: makeLineId({
      payeeRef: "P-001",
      destinationValue: "a@example.com",
      amountMinor: 2250,
      currency: "USD",
      occurrence: 0,
    }),
    sourceRow: 1,
    payeeRef: "P-001",
    payeeId: "P-001",
    displayName: "Alice",
    destination: { type: "EMAIL" as const, value: "a@example.com" },
    amount: { minor: 2250, currency: "USD" as const },
    note: "",
    include: true,
  };
  const lineB = {
    lineId: makeLineId({
      payeeRef: "P-002",
      destinationValue: "b@example.com",
      amountMinor: 1000,
      currency: "USD",
      occurrence: 0,
    }),
    sourceRow: 2,
    payeeRef: "P-002",
    payeeId: "P-002",
    displayName: "Bob",
    destination: { type: "EMAIL" as const, value: "b@example.com" },
    amount: { minor: 1000, currency: "USD" as const },
    note: "",
    include: true,
  };

  return {
    schemaVersion: 1,
    kind: "payout-plan",
    runId: "run-1",
    parentHash: null,
    source: { filename: "batch.csv", sha256: "abc", rowCount: 2 },
    cycleDate: "2026-10-28",
    baseline: {
      payeeMasterVersion: 1,
      historyWatermark: "2026-09-30T00:00:00.000Z",
      policyVersion: "policy.v1",
    },
    currency: "USD",
    lines: [lineA, lineB],
    totals: { includedCount: 2, includedMinor: 3250 },
    ...overrides,
  };
}

describe("canonicalize", () => {
  it("rejects floats", () => {
    expect(() => canonicalize(1.5)).toThrow(/non-integer/);
  });

  it("sorts object keys", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("planHash", () => {
  it("is stable when rows are shuffled", () => {
    const a = samplePlan();
    const b = samplePlan({
      lines: [...a.lines].reverse().map((line, i) => ({
        ...line,
        sourceRow: i + 1,
      })),
    });
    expect(planHash(a)).toBe(planHash(b));
  });

  it("ignores runId, filename, and parentHash", () => {
    const a = samplePlan();
    const b = samplePlan({
      runId: "run-other",
      parentHash: "sha256:" + "0".repeat(64),
      source: { filename: "other.csv", sha256: "abc", rowCount: 2 },
    });
    expect(planHash(a)).toBe(planHash(b));
  });

  it("changes when amount changes", () => {
    const a = samplePlan();
    const b = samplePlan({
      lines: a.lines.map((line, i) =>
        i === 0 ? { ...line, amount: { minor: 9999, currency: "USD" as const } } : line,
      ),
      totals: { includedCount: 2, includedMinor: 10999 },
    });
    expect(planHash(a)).not.toBe(planHash(b));
  });

  it("changes when include flag changes", () => {
    const a = samplePlan();
    const b = samplePlan({
      lines: a.lines.map((line, i) => (i === 0 ? { ...line, include: false } : line)),
      totals: { includedCount: 1, includedMinor: 1000 },
    });
    expect(planHash(a)).not.toBe(planHash(b));
  });

  it("changes when destination changes", () => {
    const a = samplePlan();
    const b = samplePlan({
      lines: a.lines.map((line, i) =>
        i === 0
          ? {
              ...line,
              destination: { type: "EMAIL" as const, value: "changed@example.com" },
            }
          : line,
      ),
    });
    expect(planHash(a)).not.toBe(planHash(b));
  });
});

describe("makeLineId", () => {
  it("gives distinct ids for duplicate occurrences", () => {
    const args = {
      payeeRef: "P-Aiko",
      destinationValue: "aiko@example.com",
      amountMinor: 1500,
      currency: "USD",
    };
    expect(makeLineId({ ...args, occurrence: 0 })).not.toBe(
      makeLineId({ ...args, occurrence: 1 }),
    );
  });
});
