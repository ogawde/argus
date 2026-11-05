import type { Prisma } from "@prisma/client";
import type { Flag } from "@/domain/plan";
import { prisma } from "@/server/db";
import { createPrismaRationaleStore } from "@/server/llm/cache";
import { createRationaleDepsFromEnv, getRationales } from "@/server/llm/rationale";
import { bundleFromFlag } from "@/server/llm/template";

/** Fill Flag.rationale from cache/live/template after deterministic flags exist. */
export async function attachRationales(
  runId: string,
  planHash: string,
  flags: Flag[],
): Promise<void> {
  if (flags.length === 0) return;

  const deps = createRationaleDepsFromEnv(createPrismaRationaleStore());
  const rationales = await getRationales(
    flags.map((f) => bundleFromFlag(f)),
    deps,
  );

  await Promise.all(
    flags.map((flag, i) =>
      prisma.flag.update({
        where: {
          runId_planHash_lineId_ruleId: {
            runId,
            planHash,
            lineId: flag.lineId,
            ruleId: flag.ruleId,
          },
        },
        data: { rationale: rationales[i]! as unknown as Prisma.InputJsonValue },
      }),
    ),
  );
}
