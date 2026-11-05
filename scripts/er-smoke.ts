import { loadEnvFiles } from "./load-env";

loadEnvFiles();

import { collectDemoFlags } from "./seed/demo-flags";

/** Prints the ENTITY_MATCH flags for the demo batch (needs seeded Postgres + Elasticsearch). */
async function main() {
  const started = Date.now();
  const { plan, flags, skipped } = await collectDemoFlags();
  const erFlags = flags.filter((flag) => flag.ruleId === "ENTITY_MATCH");

  console.log(`${flags.length} flags total, ${erFlags.length} ENTITY_MATCH (${Date.now() - started} ms)`);
  for (const message of skipped) console.log(`skipped: ${message}`);

  for (const flag of erFlags) {
    const line = plan.lines.find((l) => l.lineId === flag.lineId)!;
    console.log(`\n${line.displayName} <${line.destination.value}> -> ${flag.severity} blocking=${flag.blocking}`);
    for (const item of flag.evidence) console.log(`   ${item.key} = ${item.value}`);
    console.log(`   related: ${flag.relatedLineIds.join(",") || "-"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
