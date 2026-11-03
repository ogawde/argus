import type { Flag } from "../plan";
import { median, robustZ } from "../stats";
import type { RuleContext } from "./types";

/**
 * Batch-level flag: attached to a synthetic lineId "__BATCH__" so it can travel with Analysis.
 * Not a per-payee line flag; UI can render specially.
 */
export function ruleBatchTotalDeviation(ctx: RuleContext): Flag[] {
  const priors = ctx.priorBatchTotalsMinor;
  if (priors.length < 3) return [];

  const total = ctx.plan.totals.includedMinor;
  const z = Math.abs(robustZ(total, priors));
  const { warnZScore, infoZScore } = ctx.policy.batchTotalDeviation;

  let severity: "INFO" | "WARN" | null = null;
  if (z > warnZScore) severity = "WARN";
  else if (z > infoZScore) severity = "INFO";
  if (!severity) return [];

  return [
    {
      lineId: "__BATCH__",
      ruleId: "BATCH_TOTAL_DEVIATION",
      severity,
      blocking: false,
      evidence: [
        { key: "batchTotalMinor", label: "Batch total", value: total },
        { key: "priorMedian", label: "Prior median", value: median(priors) },
        { key: "robustZ", label: "Robust z", value: Number.isFinite(z) ? Number(z.toFixed(3)) : z },
      ],
      relatedLineIds: [],
    },
  ];
}
