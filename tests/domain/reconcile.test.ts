import { describe, expect, it } from "vitest";
import { canAdvanceStatus, reconcile, type ReconcileItem, type ReconcilePlanLine } from "@/domain/reconcile";

const line = (id: string, amount = 100): ReconcilePlanLine => ({
  lineId: id,
  senderItemId: `s-${id}`,
  amountMinor: amount,
  include: true,
});

const item = (id: string, status: string, amount = 100): ReconcileItem => ({
  lineId: id,
  senderItemId: `s-${id}`,
  amountMinor: amount,
  status,
});

describe("reconcile", () => {
  it("is CLEAN when every included line succeeded", () => {
    const report = reconcile([line("a"), line("b")], [item("a", "SUCCESS"), item("b", "SUCCESS")]);
    expect(report.outcome).toBe("CLEAN");
    expect(report.settled).toBe(true);
  });

  it("is WITH_EXCEPTIONS when one item is UNCLAIMED", () => {
    const report = reconcile([line("a"), line("b")], [item("a", "SUCCESS"), item("b", "UNCLAIMED")]);
    expect(report.outcome).toBe("WITH_EXCEPTIONS");
    expect(report.statusCounts.UNCLAIMED).toBe(1);
  });

  it("flags a mismatched amount, a missing line, and an unexpected item", () => {
    const report = reconcile(
      [line("a", 100), line("b", 200)],
      [item("a", "SUCCESS", 50), item("c", "SUCCESS")],
    );
    expect(report.amountMismatch).toEqual(["a"]);
    expect(report.missing).toEqual(["b"]);
    expect(report.unexpected).toEqual(["s-c"]);
    expect(report.outcome).toBe("WITH_EXCEPTIONS");
  });

  it("is FAILED when the batch is denied", () => {
    const report = reconcile([line("a")], [item("a", "PENDING")], "DENIED");
    expect(report.outcome).toBe("FAILED");
    expect(report.settled).toBe(true);
  });

  it("does not move a terminal status backwards", () => {
    expect(canAdvanceStatus("SUCCESS", "PENDING")).toBe(false);
    expect(canAdvanceStatus("PENDING", "SUCCESS")).toBe(true);
    expect(canAdvanceStatus("SUCCESS", "SUCCESS")).toBe(false);
  });
});
