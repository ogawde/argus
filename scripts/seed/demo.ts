import { loadEnvFiles } from "../load-env";

loadEnvFiles();

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalize } from "../../src/domain/hash";
import { buildDemoDataset, type DemoDataset } from "./dataset";
import { verifyDemoData } from "./verify";

const DEFAULT_CYCLE_DATE = "2026-10-28";
const CSV_RELATIVE_PATH = path.join("data", "demo", "october-batch.csv");
const CHUNK_SIZE = 500;

function readCycleDate(): Date {
  const raw = process.env.DEMO_CYCLE_DATE || DEFAULT_CYCLE_DATE;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`DEMO_CYCLE_DATE must be YYYY-MM-DD, got "${raw}"`);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`DEMO_CYCLE_DATE is not a real date: ${raw}`);
  return date;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function writeCsv(dataset: DemoDataset): Promise<{ file: string; sha256: string }> {
  const file = path.join(process.cwd(), CSV_RELATIVE_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, dataset.csvText, "utf8");
  const sha256 = createHash("sha256").update(dataset.csvText, "utf8").digest("hex");
  return { file, sha256 };
}

async function main() {
  const cycleDate = readCycleDate();
  const dataset = buildDemoDataset(cycleDate);
  const csv = await writeCsv(dataset);

  // import after env is loaded so Prisma sees DATABASE_URL
  const { prisma } = await import("../../src/server/db");

  try {
    // wipe + reinsert so a second run leaves identical rows (same ids, same data)
    await prisma.$transaction(
      async (tx) => {
        await tx.historicalPayout.deleteMany();
        await tx.payee.deleteMany();
        await tx.payee.createMany({ data: dataset.payees });
        for (const part of chunk(dataset.history, CHUNK_SIZE)) {
          await tx.historicalPayout.createMany({ data: part });
        }
      },
      { timeout: 60_000 },
    );

    // read back what Postgres actually has and check it against BRIEF §9
    const payees = await prisma.payee.findMany({ orderBy: { id: "asc" } });
    const history = await prisma.historicalPayout.findMany({ orderBy: { id: "asc" } });

    const dbHash = createHash("sha256")
      .update(
        canonicalize({
          payees: payees.map((p) => ({
            ...p,
            createdAt: p.createdAt.toISOString(),
            destinationChangedAt: p.destinationChangedAt?.toISOString() ?? null,
          })),
          history: history.map((h) => ({ ...h, paidAt: h.paidAt.toISOString() })),
        }),
        "utf8",
      )
      .digest("hex");

    const result = verifyDemoData({
      csvText: dataset.csvText,
      cycleDate,
      payees,
      history,
    });

    const unclaimed = payees.filter((p) => !p.sandboxRemap).map((p) => `${p.id} ${p.displayName}`);

    console.log("Argus demo seed");
    console.log(`  cycle date        : ${cycleDate.toISOString().slice(0, 10)}`);
    console.log(`  payees            : ${payees.length}`);
    console.log(`  historical payouts: ${history.length}`);
    console.log(`  october csv       : ${csv.file}`);
    console.log(`  csv rows          : ${result.lineCount} (+ header)`);
    console.log(`  csv sha256        : ${csv.sha256}`);
    console.log(`  batch total       : $${(result.totalMinor / 100).toFixed(2)}`);
    console.log(`  db content sha256 : ${dbHash}`);
    console.log(`  plan hash         : ${result.planHash}`);
    console.log(`  sandboxRemap=false: ${unclaimed.join(", ") || "none"}`);
    console.log(`  phase-2 flags (${result.flagCount}):`);
    for (const key of result.flaggedLines) console.log(`    ${key}`);

    if (result.failures.length > 0) {
      console.error("\nSeed does NOT match BRIEF §9:");
      for (const f of result.failures) console.error(`  - ${f}`);
      process.exitCode = 1;
      return;
    }
    console.log("  phase-2 contract  : OK");

    // committed LLM rationales -> AnalysisCache (LLM_MODE=cached reads them)
    const { loadRationaleCache } = await import("./load-rationales");
    const rationaleCount = await loadRationaleCache(prisma);
    console.log(`  rationale cache   : ${rationaleCount} entries loaded`);

    // Phase 3: mirror Postgres into Elastic (needs ES + the embedding model)
    const { getEmbeddingProvider } = await import("../../src/server/embeddings");
    const { reindexElastic } = await import("../../src/server/elastic/ingest");
    console.log("  elastic           : loading embedding model + indexing...");
    const elastic = await reindexElastic({ payees, history, provider: getEmbeddingProvider() });
    console.log(`  elastic history   : ${elastic.historyCount} docs (payout-history)`);
    console.log(`  elastic identities: ${elastic.identityCount} docs (payee-identities)`);
    if (elastic.historyCount !== history.length || elastic.identityCount !== payees.length) {
      console.error("Elastic doc counts do not match Postgres");
      process.exitCode = 1;
      return;
    }

    // Phase 3: plan the October CSV with ES|QL + ER rules and check the full BRIEF §9 flag set
    const { verifyDemoDataPhase3 } = await import("./verify-phase3");
    const phase3 = await verifyDemoDataPhase3({ csvText: dataset.csvText, cycleDate });
    console.log(`  phase-3 flags (${phase3.flagCount}) on ${phase3.distinctFlaggedLines} lines (${phase3.collectMs} ms):`);
    for (const key of phase3.flaggedLines) console.log(`    ${key}`);
    if (phase3.failures.length > 0) {
      console.error("\nSeed does NOT match BRIEF §9 (Phase 3):");
      for (const f of phase3.failures) console.error(`  - ${f}`);
      process.exitCode = 1;
      return;
    }
    console.log("  contract check    : OK (full BRIEF §9, 10 flagged lines)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
