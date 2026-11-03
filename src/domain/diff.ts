import type { PlanLine } from "./plan";

export type DiffKind = "added" | "removed" | "changed" | "unchanged";

export interface DiffLine {
  payeeRef: string;
  kind: DiffKind;
  before?: { amountMinor: number; destination: string; displayName: string };
  after?: { amountMinor: number; destination: string; displayName: string };
  deltaMinor?: number;
}

function snap(line: PlanLine) {
  return {
    amountMinor: line.amount.minor,
    destination: line.destination.value,
    displayName: line.displayName,
  };
}

/** Diff current batch vs prior cycle lines by payeeRef (first occurrence wins). */
export function diffPlans(
  previous: PlanLine[] | null | undefined,
  current: PlanLine[],
): DiffLine[] {
  const prevMap = new Map<string, PlanLine>();
  for (const line of previous ?? []) {
    if (!prevMap.has(line.payeeRef)) prevMap.set(line.payeeRef, line);
  }
  const curMap = new Map<string, PlanLine>();
  for (const line of current) {
    if (!curMap.has(line.payeeRef)) curMap.set(line.payeeRef, line);
  }

  const refs = new Set([...prevMap.keys(), ...curMap.keys()]);
  const out: DiffLine[] = [];
  for (const payeeRef of [...refs].sort()) {
    const before = prevMap.get(payeeRef);
    const after = curMap.get(payeeRef);
    if (!before && after) {
      out.push({ payeeRef, kind: "added", after: snap(after) });
    } else if (before && !after) {
      out.push({ payeeRef, kind: "removed", before: snap(before) });
    } else if (before && after) {
      const b = snap(before);
      const a = snap(after);
      if (
        b.amountMinor !== a.amountMinor ||
        b.destination !== a.destination ||
        b.displayName !== a.displayName
      ) {
        out.push({
          payeeRef,
          kind: "changed",
          before: b,
          after: a,
          deltaMinor: a.amountMinor - b.amountMinor,
        });
      } else {
        out.push({ payeeRef, kind: "unchanged", before: b, after: a });
      }
    }
  }
  return out;
}
