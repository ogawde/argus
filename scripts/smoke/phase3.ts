/**
 * Smoke: plan the October demo batch (collectAllFlags) and assert the BRIEF §9 flag set.
 * Needs `pnpm seed:demo` first (Postgres + Elastic). Prints timing; LLM is not involved.
 */
import { loadEnvFiles } from "../load-env";

loadEnvFiles();

import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_COLLECT_MS = 15_000;

async function main() {
  const { verifyDemoDataPhase3 } = await import("../seed/verify-phase3");
  const { getEmbeddingProvider } = await import("../../src/server/embeddings");
  const { prisma } = await import("../../src/server/db");

  try {
    const cycleDate = new Date(`${process.env.DEMO_CYCLE_DATE ?? "2026-10-28"}T00:00:00.000Z`);
    const csvText = await readFile(path.join(process.cwd(), "data/demo/october-batch.csv"), "utf8");

    // load the embedding model first so the timed step is the steady-state planning cost
    const warmStarted = Date.now();
    await getEmbeddingProvider().embed(["argus warm up"]);
    const warmMs = Date.now() - warmStarted;

    const result = await verifyDemoDataPhase3({ csvText, cycleDate });

    console.log(`Argus Phase 3 smoke (${result.lineCount} lines)`);
    console.log(`  embedding warm-up : ${warmMs} ms`);
    console.log(`  collectAllFlags   : ${result.collectMs} ms (limit ${MAX_COLLECT_MS} ms, no LLM)`);
    console.log(`  flags (${result.flagCount}) on ${result.distinctFlaggedLines} lines:`);
    for (const key of result.flaggedLines) console.log(`    ${key}`);

    const failures = [...result.failures];
    if (result.collectMs > MAX_COLLECT_MS) failures.push(`collectAllFlags took ${result.collectMs} ms`);

    if (failures.length > 0) {
      console.error("SMOKE FAILED:");
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
      return;
    }
    console.log("SMOKE OK: BRIEF §9 flag set matches (10 flagged lines)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
