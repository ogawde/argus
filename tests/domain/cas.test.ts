import { describe, expect, it } from "vitest";
import { canTransition } from "@/domain/state";

/**
 * Lightweight stand-in for DB CAS: only one updater with the matching
 * rowVersion "wins"; the loser must re-read.
 */
function casUpdate(
  store: { status: string; rowVersion: number },
  expectVersion: number,
  nextStatus: string,
): boolean {
  if (store.rowVersion !== expectVersion) return false;
  if (!canTransition(store.status as never, nextStatus as never)) return false;
  store.status = nextStatus;
  store.rowVersion += 1;
  return true;
}

describe("CAS race (in-memory model of rowVersion)", () => {
  it("exactly one winner when two updaters race", () => {
    const store = { status: "DRAFT", rowVersion: 0 };
    const a = casUpdate(store, 0, "PLANNING");
    const b = casUpdate(store, 0, "PLANNING");
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(store.status).toBe("PLANNING");
    expect(store.rowVersion).toBe(1);
  });

  it("revoke then re-approve path is allowed by the state machine", () => {
    expect(canTransition("READY", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "READY")).toBe(true);
    expect(canTransition("READY", "APPROVED")).toBe(true);
  });
});
