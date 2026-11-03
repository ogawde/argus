import { createHash } from "node:crypto";
import type { CsvRowOk } from "./csv";
import { normalizeEmail } from "./normalize";
import { makeLineId, type PlanFile, type PlanLine } from "./plan";
import { planHash } from "./hash";

export interface PayeeLookup {
  id: string;
  displayName: string;
  destinationValue: string;
}

export interface BuildPlanInput {
  runId: string;
  filename: string;
  fileBytes: Buffer | string;
  cycleDate: string; // YYYY-MM-DD
  rows: CsvRowOk[];
  /** Map payee_ref → established payee, if any */
  payeesByRef: Map<string, PayeeLookup>;
  payeeMasterVersion: number;
  historyWatermark: string; // ISO
  policyVersion: string;
  parentHash?: string | null;
}

export function sourceSha256(fileBytes: Buffer | string): string {
  const buf = typeof fileBytes === "string" ? Buffer.from(fileBytes, "utf8") : fileBytes;
  return createHash("sha256").update(buf).digest("hex");
}

export function buildPlan(input: BuildPlanInput): { plan: PlanFile; hash: string } {
  const occurrence = new Map<string, number>();
  const currency = input.rows[0]?.currency ?? "USD";

  const lines: PlanLine[] = input.rows.map((row) => {
    const dest = normalizeEmail(row.email).normalized;
    const key = `${row.payeeRef}|${dest}|${row.amountMinor}|${row.currency}`;
    const occ = occurrence.get(key) ?? 0;
    occurrence.set(key, occ + 1);

    const known = input.payeesByRef.get(row.payeeRef) ?? null;
    const lineId = makeLineId({
      payeeRef: row.payeeRef,
      destinationValue: dest,
      amountMinor: row.amountMinor,
      currency: row.currency,
      occurrence: occ,
    });

    return {
      lineId,
      sourceRow: row.rowNumber,
      payeeRef: row.payeeRef,
      payeeId: known?.id ?? null,
      displayName: row.name,
      destination: { type: "EMAIL" as const, value: dest },
      amount: { minor: row.amountMinor, currency: row.currency },
      note: row.note,
      include: true,
    };
  });

  const included = lines.filter((l) => l.include);
  const plan: PlanFile = {
    schemaVersion: 1,
    kind: "payout-plan",
    runId: input.runId,
    parentHash: input.parentHash ?? null,
    source: {
      filename: input.filename,
      sha256: sourceSha256(input.fileBytes),
      rowCount: input.rows.length,
    },
    cycleDate: input.cycleDate,
    baseline: {
      payeeMasterVersion: input.payeeMasterVersion,
      historyWatermark: input.historyWatermark,
      policyVersion: input.policyVersion,
    },
    currency,
    lines,
    totals: {
      includedCount: included.length,
      includedMinor: included.reduce((s, l) => s + l.amount.minor, 0),
    },
  };

  return { plan, hash: planHash(plan) };
}

/** Apply EXCLUDED dispositions: set include=false, recompute totals, new parentHash. */
export function applyExclusions(
  plan: PlanFile,
  excludedLineIds: Set<string>,
  parentHash: string,
): PlanFile {
  const lines = plan.lines.map((l) =>
    excludedLineIds.has(l.lineId) ? { ...l, include: false } : l,
  );
  const included = lines.filter((l) => l.include);
  return {
    ...plan,
    parentHash,
    lines,
    totals: {
      includedCount: included.length,
      includedMinor: included.reduce((s, l) => s + l.amount.minor, 0),
    },
  };
}
