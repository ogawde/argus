import { describe, expect, it } from "vitest";

/** Mirrors createRun's ALREADY_APPLIED_SOURCE guard without hitting the DB. */
function alreadyAppliedSource(args: {
  sameSourceStatuses: string[];
  hasAppliedPlanRow: boolean;
}): boolean {
  const alreadyPaid = args.sameSourceStatuses.some((s) => s === "RECONCILED");
  return alreadyPaid || args.hasAppliedPlanRow;
}

describe("cross-run source guard", () => {
  it("blocks when a prior run with the same sourceSha256 is RECONCILED", () => {
    expect(
      alreadyAppliedSource({
        sameSourceStatuses: ["DRAFT", "RECONCILED"],
        hasAppliedPlanRow: false,
      }),
    ).toBe(true);
  });

  it("blocks when AppliedPlan exists for a same-source run", () => {
    expect(
      alreadyAppliedSource({
        sameSourceStatuses: ["APPROVED"],
        hasAppliedPlanRow: true,
      }),
    ).toBe(true);
  });

  it("allows a fresh file with no applied history", () => {
    expect(
      alreadyAppliedSource({
        sameSourceStatuses: ["DRAFT", "FLAGGED"],
        hasAppliedPlanRow: false,
      }),
    ).toBe(false);
  });
});
