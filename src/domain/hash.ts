import { createHash } from "node:crypto";
import type { PlanFile } from "./plan";

/** JCS-style canonicalize: sorted object keys, no whitespace, safe integers only. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") {
    return JSON.stringify(v);
  }
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) {
      throw new Error("non-integer number in hashed payload");
    }
    return String(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map(canonicalize).join(",")}]`;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => {
        if (o[k] === undefined) throw new Error(`undefined at ${k}`);
        return `${JSON.stringify(k)}:${canonicalize(o[k])}`;
      })
      .join(",")}}`;
  }
  throw new Error("unsupported type");
}

export function sha256(s: string): string {
  return "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");
}

/** Only execution-relevant fields are hashed (ARCHITECTURE §8.3). */
export function hashablePlan(p: PlanFile) {
  return {
    schemaVersion: p.schemaVersion,
    kind: p.kind,
    cycleDate: p.cycleDate,
    baseline: p.baseline,
    currency: p.currency,
    totals: p.totals,
    lines: [...p.lines]
      .sort((a, b) => a.lineId.localeCompare(b.lineId))
      .map((line) => {
        const { sourceRow, ...rest } = line;
        void sourceRow;
        return rest;
      }),
  };
}

export function planHash(p: PlanFile): string {
  return sha256(canonicalize(hashablePlan(p)));
}
