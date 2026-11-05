import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { StoredRationale } from "../../src/server/llm/rationale";

const FILE = path.join("data", "demo", "rationales.cache.json");

/** Copies data/demo/rationales.cache.json into the AnalysisCache table. Returns how many rows were written. */
export async function loadRationaleCache(prisma: PrismaClient): Promise<number> {
  const file = path.join(process.cwd(), FILE);
  if (!existsSync(file)) return 0;

  const entries = JSON.parse(readFileSync(file, "utf8")) as Record<string, StoredRationale>;
  let count = 0;
  for (const [key, stored] of Object.entries(entries)) {
    const value = stored as unknown as Prisma.InputJsonValue;
    await prisma.analysisCache.upsert({
      where: { key },
      create: { key, kind: "rationale", value },
      update: { kind: "rationale", value },
    });
    count++;
  }
  return count;
}
