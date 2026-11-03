import { describe, expect, it } from "vitest";
import {
  RUN_STATUSES,
  TRANSITIONS,
  canTransition,
  isTerminal,
  type RunStatus,
} from "@/domain/state";

describe("state machine", () => {
  it("rejects every pair outside TRANSITIONS", () => {
    for (const from of RUN_STATUSES) {
      for (const to of RUN_STATUSES) {
        const allowed = TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(allowed);
      }
    }
  });

  it("terminal states have no exits", () => {
    const terminals: RunStatus[] = ["RECONCILED", "REJECTED", "FAILED"];
    for (const status of terminals) {
      expect(TRANSITIONS[status]).toEqual([]);
      expect(isTerminal(status)).toBe(true);
    }
  });

  it("approval requires READY → APPROVED", () => {
    expect(canTransition("READY", "APPROVED")).toBe(true);
    expect(canTransition("FLAGGED", "APPROVED")).toBe(false);
  });

  it("APPLYING can only go to RECONCILED or FAILED", () => {
    expect(TRANSITIONS.APPLYING).toEqual(["RECONCILED", "FAILED"]);
  });
});
