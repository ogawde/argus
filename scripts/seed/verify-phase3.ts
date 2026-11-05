import { parseCsvText } from "../../src/domain/csv";
import { buildPlan } from "../../src/domain/plan-builder";
import { loadPolicy } from "../../src/domain/policy";

export interface Phase3VerifyResult {
  lineCount: number;
  flagCount: number;
  flaggedLines: string[];
  distinctFlaggedLines: number;
  failures: string[];
  /** ms spent in collectAllFlags (Phase 2 + ES|QL + ER) */
  collectMs: number;
}

type Want = { severity: string; blocking: boolean };

/** BRIEF §9: Phase 2 flags + S1/S5/S6/S9 from Elastic + ER. Keys are "payeeRef#occurrence|ruleId". */
export const EXPECTED_DEMO_FLAGS: Record<string, Want> = {
  "P-0301#1|NEW_PAYEE": { severity: "WARN", blocking: false }, // S1
  "P-0301#1|ENTITY_MATCH": { severity: "CRITICAL", blocking: true }, // S1 hero
  "P-0302#1|NEW_PAYEE": { severity: "CRITICAL", blocking: true }, // S7
  "P-0303#1|NEW_PAYEE": { severity: "WARN", blocking: false }, // S9
  "P-0303#1|ENTITY_MATCH": { severity: "WARN", blocking: false }, // S9 borderline
  "P-0042#1|DESTINATION_CHANGED": { severity: "CRITICAL", blocking: true }, // S2
  "P-0064#1|AMOUNT_DEVIATION": { severity: "CRITICAL", blocking: true }, // S3
  "P-0075#2|DUPLICATE_IN_BATCH": { severity: "CRITICAL", blocking: true }, // S4
  "P-0097#1|VELOCITY_SPIKE": { severity: "WARN", blocking: false }, // S5
  "P-0088#1|SHARED_DESTINATION": { severity: "CRITICAL", blocking: true }, // S6
  "P-0089#1|SHARED_DESTINATION": { severity: "CRITICAL", blocking: true }, // S6
  "P-0131#1|DORMANT_REACTIVATION": { severity: "WARN", blocking: false }, // S8
};

/**
 * Plans the October CSV against Postgres and checks the full BRIEF §9 flag set
 * (exactly 10 flagged lines). Needs Postgres seeded and Elastic indexed.
 * Call loadEnvFiles() before this.
 */
export async function verifyDemoDataPhase3(args: {
  csvText: string;
  cycleDate: Date;
}): Promise<Phase3VerifyResult> {
  const { prisma } = await import("../../src/server/db");
  const { loadBaseline } = await import("../../src/server/planning/context");
  const { collectAllFlags } = await import("../../src/server/planning/collect-flags");

  const failures: string[] = [];
  const policy = loadPolicy();
  const parsed = parseCsvText(args.csvText, policy.csv);
  if (parsed.errors.length > 0) failures.push(`CSV has ${parsed.errors.length} parse errors`);

  const baseline = await loadBaseline(prisma);
  const { plan } = buildPlan({
    runId: "seed-verify-phase3",
    filename: "october-batch.csv",
    fileBytes: args.csvText,
    cycleDate: args.cycleDate.toISOString().slice(0, 10),
    rows: parsed.rows,
    payeesByRef: baseline.payeesByRef,
    payeeMasterVersion: 1,
    historyWatermark: baseline.historyWatermark.toISOString(),
    policyVersion: policy.version,
  });

  const started = Date.now();
  const flags = await collectAllFlags({ plan, cycleDate: args.cycleDate, baseline });
  const collectMs = Date.now() - started;

  // key lines as "P-0075#2" (payee ref + occurrence) so duplicate rows stay distinguishable
  const seenRefs = new Map<string, number>();
  const keyByLineId = new Map<string, string>();
  for (const line of plan.lines) {
    const n = (seenRefs.get(line.payeeRef) ?? 0) + 1;
    seenRefs.set(line.payeeRef, n);
    keyByLineId.set(line.lineId, `${line.payeeRef}#${n}`);
  }

  const actual = new Map<string, Want>();
  for (const f of flags) {
    actual.set(`${keyByLineId.get(f.lineId) ?? f.lineId}|${f.ruleId}`, {
      severity: f.severity,
      blocking: f.blocking,
    });
  }

  for (const [key, want] of Object.entries(EXPECTED_DEMO_FLAGS)) {
    const got = actual.get(key);
    if (!got) failures.push(`missing expected flag ${key}`);
    else if (got.severity !== want.severity || got.blocking !== want.blocking) {
      failures.push(`${key}: got ${got.severity}/${got.blocking}, want ${want.severity}/${want.blocking}`);
    }
  }
  for (const key of actual.keys()) {
    if (!(key in EXPECTED_DEMO_FLAGS)) failures.push(`unexpected flag ${key}`);
  }

  const distinctLines = new Set([...actual.keys()].map((k) => k.split("|")[0]!));
  if (distinctLines.size !== 10) {
    failures.push(`expected exactly 10 flagged lines, got ${distinctLines.size}`);
  }
  if (actual.has("P-0118#1|ENTITY_MATCH")) failures.push("S1: John Doe (P-0118) must not be flagged");

  return {
    lineCount: plan.lines.length,
    flagCount: flags.length,
    flaggedLines: [...actual.keys()].sort(),
    distinctFlaggedLines: distinctLines.size,
    failures,
    collectMs,
  };
}
