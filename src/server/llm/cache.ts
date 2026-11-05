import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { RationaleStore, StoredRationale } from "./rationale";

export const RATIONALE_KIND = "rationale";

/** Rationales live in the AnalysisCache table (kind = "rationale"). */
export function createPrismaRationaleStore(): RationaleStore {
  return {
    async get(key) {
      const row = await prisma.analysisCache.findUnique({ where: { key } });
      if (!row || row.kind !== RATIONALE_KIND) return null;
      return row.value as unknown as StoredRationale;
    },
    async set(key, value) {
      await upsertRationale(key, value);
    },
  };
}

export async function upsertRationale(key: string, value: StoredRationale): Promise<void> {
  const json = value as unknown as Prisma.InputJsonValue;
  await prisma.analysisCache.upsert({
    where: { key },
    create: { key, kind: RATIONALE_KIND, value: json },
    update: { kind: RATIONALE_KIND, value: json },
  });
}
