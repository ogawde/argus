/**
 * Smoke: run Q1–Q4 against local ES (after `pnpm seed:demo`) and check the Phase 3 rules on the October batch.
 */
import { loadEnvFiles } from "../load-env";

loadEnvFiles();

import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const { parseCsvText } = await import("../../src/domain/csv");
  const { buildPlan } = await import("../../src/domain/plan-builder");
  const { loadPolicy } = await import("../../src/domain/policy");
  const { runPhase3ElasticRules } = await import("../../src/domain/rules/engine");
  const { fetchElasticRuleInputs, queryPayeeBaseline } = await import("../../src/server/elastic/esql");
  const { prisma } = await import("../../src/server/db");

  try {
    const policy = loadPolicy();
    const cycleDate = new Date(`${process.env.DEMO_CYCLE_DATE ?? "2026-10-28"}T00:00:00.000Z`);

    const inputs = await fetchElasticRuleInputs(cycleDate, policy);
    console.log("Q3/Q2 velocity hits:", JSON.stringify(inputs.velocityHits, null, 2));
    console.log("Q4 shared destinations:", JSON.stringify(inputs.sharedDestinations, null, 2));

    const baseline = await queryPayeeBaseline("P-0097", cycleDate);
    console.log("Q1 baseline P-0097:", baseline);

    const csvText = await readFile(path.join(process.cwd(), "data/demo/october-batch.csv"), "utf8");
    const parsed = parseCsvText(csvText, policy.csv);
    const payees = await prisma.payee.findMany();
    const { plan } = buildPlan({
      runId: "smoke",
      filename: "october-batch.csv",
      fileBytes: csvText,
      cycleDate: cycleDate.toISOString().slice(0, 10),
      rows: parsed.rows,
      payeesByRef: new Map(payees.map((p) => [p.id, p])),
      payeeMasterVersion: 1,
      historyWatermark: cycleDate.toISOString(),
      policyVersion: policy.version,
    });

    const flags = runPhase3ElasticRules(
      {
        plan,
        policy,
        cycleDate,
        historyByPayeeId: new Map(),
        payeeByRef: new Map(),
        priorBatchTotalsMinor: [],
      },
      inputs,
    );

    const refByLineId = new Map(plan.lines.map((l) => [l.lineId, l.payeeRef]));
    const summary = flags.map((f) => `${refByLineId.get(f.lineId)}|${f.ruleId}|${f.severity}|blocking=${f.blocking}`);
    console.log("Phase 3 flags:\n  " + summary.join("\n  "));

    const expected = [
      "P-0088|SHARED_DESTINATION|CRITICAL|blocking=true",
      "P-0089|SHARED_DESTINATION|CRITICAL|blocking=true",
      "P-0097|VELOCITY_SPIKE|WARN|blocking=false",
    ];
    const ok = JSON.stringify([...summary].sort()) === JSON.stringify(expected);
    console.log(ok ? "SMOKE OK" : "SMOKE FAILED: expected exactly S5 + S6 flags");
    if (!ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
