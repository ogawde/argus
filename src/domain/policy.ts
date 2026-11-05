import { z } from "zod";
import policyJson from "../../policy.v1.json";

const PolicySchema = z.object({
  version: z.string(),
  newPayee: z.object({
    defaultSeverity: z.enum(["INFO", "WARN", "CRITICAL"]),
    escalateAmountVsBatchP95Multiplier: z.number(),
    escalateSeverity: z.enum(["INFO", "WARN", "CRITICAL"]),
  }),
  destinationChanged: z.object({
    windowDays: z.number().int().positive(),
    severity: z.enum(["INFO", "WARN", "CRITICAL"]),
    blocking: z.boolean(),
  }),
  amountDeviation: z.object({
    zScoreThreshold: z.number(),
    absoluteMultipleOfMedian: z.number(),
    criticalZScore: z.number(),
    warnZScore: z.number(),
  }),
  duplicateInBatch: z.object({
    severity: z.enum(["INFO", "WARN", "CRITICAL"]),
    blocking: z.boolean(),
  }),
  duplicatePaymentWindow: z.object({
    severity: z.enum(["INFO", "WARN", "CRITICAL"]),
    blocking: z.boolean(),
  }),
  dormantReactivation: z.object({
    idleDays: z.number().int().positive(),
    severity: z.enum(["INFO", "WARN", "CRITICAL"]),
    blocking: z.boolean(),
  }),
  batchTotalDeviation: z.object({
    warnZScore: z.number(),
    infoZScore: z.number(),
  }),
  velocity: z
    .object({
      burstDays: z.number().int().positive(),
      burstMin: z.number().int().positive(),
      cadenceMultiplier: z.number().positive(),
      lookbackDays: z.number().int().positive(),
      severity: z.enum(["INFO", "WARN", "CRITICAL"]),
      blocking: z.boolean(),
    })
    .refine((v) => v.lookbackDays > v.burstDays, {
      message: "velocity.lookbackDays must be greater than burstDays",
    }),
  sharedDestination: z.object({
    enabled: z.boolean(),
    severity: z.enum(["INFO", "WARN", "CRITICAL"]),
    blocking: z.boolean(),
  }),
  csv: z.object({
    maxRows: z.number().int().positive(),
    maxBytes: z.number().int().positive(),
  }),
  er: z.object({
    recentDays: z.number().int().positive(),
  }),
});

export type Policy = z.infer<typeof PolicySchema>;

let cached: Policy | null = null;

export function loadPolicy(): Policy {
  if (cached) return cached;
  cached = PolicySchema.parse(policyJson);
  return cached;
}

export function resetPolicyCache(): void {
  cached = null;
}
