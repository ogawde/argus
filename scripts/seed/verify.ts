import { parseCsvText } from "../../src/domain/csv";
import { buildPlan, type PayeeLookup } from "../../src/domain/plan-builder";
import { loadPolicy } from "../../src/domain/policy";
import { runPhase2Rules } from "../../src/domain/rules/engine";
import type {
  HistoricalPayoutView,
  PayeeView,
  RuleContext,
} from "../../src/domain/rules/types";

export interface VerifyPayeeRow extends PayeeView {
  displayName: string;
}

export interface VerifyInput {
  csvText: string;
  cycleDate: Date;
  payees: VerifyPayeeRow[];
  history: HistoricalPayoutView[];
}

export interface VerifyResult {
  planHash: string;
  lineCount: number;
  totalMinor: number;
  flagCount: number;
  flaggedLines: string[];
  failures: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Re-reads the seeded data the way the planner will and checks BRIEF §9.
 * Only Phase 2 (domain) rules run here; S1 ENTITY_MATCH, S5 and S6 need Elastic (Phase 3).
 */
export function verifyDemoData(input: VerifyInput): VerifyResult {
  const failures: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };

  const policy = loadPolicy();
  const parsed = parseCsvText(input.csvText, policy.csv);
  check(parsed.errors.length === 0, `CSV has ${parsed.errors.length} parse errors`);
  check(parsed.rows.length === 300, `CSV has ${parsed.rows.length} rows, expected 300`);

  const payeeByRef = new Map(input.payees.map((p) => [p.id, p]));
  const payeesByRef = new Map<string, PayeeLookup>(
    input.payees.map((p) => [
      p.id,
      { id: p.id, displayName: p.displayName, destinationValue: p.destinationValue },
    ]),
  );

  const historyByPayeeId = new Map<string, HistoricalPayoutView[]>();
  for (const h of input.history) {
    const list = historyByPayeeId.get(h.payeeId) ?? [];
    list.push(h);
    historyByPayeeId.set(h.payeeId, list);
  }

  // prior monthly batch totals (ad-hoc extras are not a batch)
  const totalsByBatch = new Map<string, number>();
  for (const h of input.history) {
    if (!h.batchRef.startsWith("cycle-")) continue;
    totalsByBatch.set(h.batchRef, (totalsByBatch.get(h.batchRef) ?? 0) + h.amountMinor);
  }
  check(totalsByBatch.size === 12, `expected 12 history cycles, got ${totalsByBatch.size}`);

  const watermark = input.history.reduce(
    (max, h) => (h.paidAt > max ? h.paidAt : max),
    new Date(0),
  );
  const cycleIso = input.cycleDate.toISOString().slice(0, 10);

  const { plan, hash } = buildPlan({
    runId: "seed-verify",
    filename: "october-batch.csv",
    fileBytes: input.csvText,
    cycleDate: cycleIso,
    rows: parsed.rows,
    payeesByRef,
    payeeMasterVersion: 1,
    historyWatermark: watermark.toISOString(),
    policyVersion: policy.version,
  });

  const ctx: RuleContext = {
    plan,
    policy,
    cycleDate: input.cycleDate,
    historyByPayeeId,
    payeeByRef,
    priorBatchTotalsMinor: [...totalsByBatch.values()],
  };
  const flags = runPhase2Rules(ctx);

  // key lines as "P-0075#2" (payee ref + occurrence) so duplicates are distinguishable
  const seenRefs = new Map<string, number>();
  const keyByLineId = new Map<string, string>();
  for (const line of plan.lines) {
    const n = (seenRefs.get(line.payeeRef) ?? 0) + 1;
    seenRefs.set(line.payeeRef, n);
    keyByLineId.set(line.lineId, `${line.payeeRef}#${n}`);
  }

  const actual = new Map<string, { severity: string; blocking: boolean }>();
  for (const f of flags) {
    actual.set(`${keyByLineId.get(f.lineId) ?? f.lineId}|${f.ruleId}`, {
      severity: f.severity,
      blocking: f.blocking,
    });
  }

  const expected: Record<string, { severity: string; blocking: boolean }> = {
    "P-0301#1|NEW_PAYEE": { severity: "WARN", blocking: false }, // S1 Jon Doe
    "P-0302#1|NEW_PAYEE": { severity: "CRITICAL", blocking: true }, // S7 Orbit, escalated
    "P-0303#1|NEW_PAYEE": { severity: "WARN", blocking: false }, // S9 Muhammad
    "P-0042#1|DESTINATION_CHANGED": { severity: "CRITICAL", blocking: true }, // S2
    "P-0064#1|AMOUNT_DEVIATION": { severity: "CRITICAL", blocking: true }, // S3
    "P-0075#2|DUPLICATE_IN_BATCH": { severity: "CRITICAL", blocking: true }, // S4 second row only
    "P-0131#1|DORMANT_REACTIVATION": { severity: "WARN", blocking: false }, // S8
  };

  for (const [key, want] of Object.entries(expected)) {
    const got = actual.get(key);
    if (!got) failures.push(`missing expected flag ${key}`);
    else if (got.severity !== want.severity || got.blocking !== want.blocking) {
      failures.push(`${key}: got ${got.severity}/${got.blocking}, want ${want.severity}/${want.blocking}`);
    }
  }
  for (const key of actual.keys()) {
    if (!(key in expected)) failures.push(`unexpected flag ${key}`);
  }

  // must-not-fire: covered by the exact-match above (no BATCH_TOTAL_DEVIATION, no DUPLICATE_PAYMENT_WINDOW)

  // contract checks
  const newLines = plan.lines.filter((l) => l.payeeId === null).map((l) => l.payeeRef);
  check(
    newLines.length === 3 && ["P-0301", "P-0302", "P-0303"].every((r) => newLines.includes(r)),
    `new payees in batch should be exactly P-0301/2/3, got ${newLines.join(",")}`,
  );
  check(plan.totals.includedMinor <= 400000, `batch total ${plan.totals.includedMinor} exceeds $4,000`);

  const bigExceptions = new Set(["P-0064", "P-0302"]);
  for (const line of plan.lines) {
    if (bigExceptions.has(line.payeeRef)) continue;
    if (line.amount.minor < 400 || line.amount.minor > 3000) {
      failures.push(`${line.payeeRef} amount ${line.amount.minor} outside $4-$30`);
    }
  }

  const amountOf = (ref: string) => plan.lines.find((l) => l.payeeRef === ref)?.amount.minor;
  check(amountOf("P-0301") === 2250 && amountOf("P-0118") === 2250, "S1: Jon and John must both be $22.50");
  check(amountOf("P-0302") === 30000, "S7: Orbit Labs must be $300.00");
  check(amountOf("P-0064") === 45000, "S3: Carlos must be $450.00");

  const johnStillInBatch = plan.lines.some((l) => l.payeeRef === "P-0118");
  check(johnStillInBatch && !actual.has("P-0118#1|ENTITY_MATCH"), "S1: John Doe must be in batch and unflagged");

  const ravi = historyByPayeeId.get("P-0097") ?? [];
  const recent = ravi.filter((h) => {
    const days = (input.cycleDate.getTime() - h.paidAt.getTime()) / DAY_MS;
    return days >= 0 && days <= 9;
  });
  check(recent.length === 4, `S5: Ravi should have 4 payouts in the last 9 days, got ${recent.length}`);
  check(
    recent.every((h) => h.amountMinor !== amountOf("P-0097")),
    "S5: Ravi's recent payouts must differ from his October amount",
  );

  const northwind = payeeByRef.get("P-0088");
  const lena = payeeByRef.get("P-0089");
  check(
    !!northwind && !!lena && northwind.destinationFingerprint === lena.destinationFingerprint,
    "S6: Northwind and Lena must share a destination",
  );

  return {
    planHash: hash,
    lineCount: plan.lines.length,
    totalMinor: plan.totals.includedMinor,
    flagCount: flags.length,
    flaggedLines: [...actual.keys()].sort(),
    failures,
  };
}
