import { readFileSync } from "node:fs";
import type { Flag, PlanFile } from "../../src/domain/plan";

export interface DemoFlags {
  plan: PlanFile;
  cycleDate: Date;
  flags: Flag[];
  /** parts that could not run (e.g. Elasticsearch is down) */
  skipped: string[];
}

/**
 * Plans the committed demo CSV against Postgres and collects every flag the rules produce:
 * Phase 2 rules + ES|QL rules + entity resolution.
 * Needs a seeded Postgres; Elasticsearch parts are skipped with a message if they fail.
 * Call loadEnvFiles() before this.
 */
export async function collectDemoFlags(): Promise<DemoFlags> {
  const { parseCsvText } = await import("../../src/domain/csv");
  const { buildPlan } = await import("../../src/domain/plan-builder");
  const { loadPolicy } = await import("../../src/domain/policy");
  const { runPhase2Rules, runPhase3ElasticRules } = await import("../../src/domain/rules/engine");
  const { prisma } = await import("../../src/server/db");
  const { loadBaseline, makeRuleContext } = await import("../../src/server/planning/context");
  const { fetchElasticRuleInputs } = await import("../../src/server/elastic/esql");
  const { resolveEntityMatches } = await import("../../src/server/er/resolve");

  const text = readFileSync("data/demo/october-batch.csv", "utf8");
  const policy = loadPolicy();
  const parsed = parseCsvText(text, policy.csv);
  if (parsed.errors.length > 0) throw new Error("demo CSV does not parse");

  const cycleDate = new Date(`${process.env.DEMO_CYCLE_DATE ?? "2026-10-28"}T00:00:00.000Z`);
  const baseline = await prisma.$transaction((tx) => loadBaseline(tx));
  const payees = await prisma.payee.findMany();

  const { plan } = buildPlan({
    runId: "demo-flags",
    filename: "october-batch.csv",
    fileBytes: text,
    cycleDate: cycleDate.toISOString().slice(0, 10),
    rows: parsed.rows,
    payeesByRef: baseline.payeesByRef,
    payeeMasterVersion: 1,
    historyWatermark: baseline.historyWatermark.toISOString(),
    policyVersion: policy.version,
  });

  const ctx = makeRuleContext(plan, cycleDate, baseline);
  const flags: Flag[] = [...runPhase2Rules(ctx)];
  const skipped: string[] = [];

  try {
    flags.push(...runPhase3ElasticRules(ctx, await fetchElasticRuleInputs(cycleDate, policy)));
  } catch (err) {
    skipped.push(`ES|QL rules: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    flags.push(
      ...(await resolveEntityMatches({
        plan,
        cycleDate,
        payeesById: new Map(payees.map((p) => [p.id, p])),
        historyByPayeeId: baseline.historyByPayeeId,
      })),
    );
  } catch (err) {
    skipped.push(`entity resolution: ${err instanceof Error ? err.message : String(err)}`);
  }

  await prisma.$disconnect();
  return { plan, cycleDate, flags, skipped };
}
