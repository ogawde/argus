/**
 * QA helper: create a DRAFT run from data/demo/october-batch.csv as "maya"
 * (same steps as the createRun action, without the browser upload).
 * Then open /runs/<id> as Maya and click "Start planning".
 *
 *   pnpm qa:draft-run
 */
import { loadEnvFiles } from "../load-env";

loadEnvFiles();

import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const { prisma } = await import("../../src/server/db");
  const { appendAudit } = await import("../../src/server/audit");
  const { sourceSha256 } = await import("../../src/domain/plan-builder");
  const { sourceCacheKey } = await import("../../src/server/planning/run-planning");

  try {
    const filename = "october-batch.csv";
    const text = await readFile(path.join(process.cwd(), "data/demo", filename), "utf8");
    const cycle = process.env.DEMO_CYCLE_DATE ?? "2026-10-28";
    const sha = sourceSha256(text);
    const newest = await prisma.payee.aggregate({ _max: { version: true } });

    const runId = await prisma.$transaction(async (tx) => {
      const run = await tx.payoutRun.create({
        data: {
          status: "DRAFT",
          preparedById: "maya",
          cycleDate: new Date(`${cycle}T00:00:00.000Z`),
          sourceFilename: filename,
          sourceSha256: sha,
          payeeMasterVersion: newest._max.version ?? 1,
        },
      });
      await tx.analysisCache.create({
        data: { key: sourceCacheKey(run.id), kind: "csv", value: { filename, text } },
      });
      await appendAudit(tx, {
        actorId: "maya",
        type: "RUN_CREATED",
        runId: run.id,
        data: { filename, sourceSha256: sha, rowCount: text.trim().split("\n").length - 1, cycleDate: cycle },
      });
      return run.id;
    });

    console.log(`Created DRAFT run ${runId}`);
    console.log(`Open http://localhost:3000/runs/${runId} as Maya and click "Start planning".`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
