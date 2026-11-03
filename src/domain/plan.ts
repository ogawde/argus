import { createHash } from "node:crypto";
import { z } from "zod";

export const CurrencySchema = z.enum(["USD", "EUR", "GBP"]);
export const MoneySchema = z.object({
  minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: CurrencySchema,
});

export const PlanLineSchema = z.object({
  lineId: z.string().regex(/^L[0-9a-f]{12}$/),
  sourceRow: z.number().int().positive(),
  payeeRef: z.string().min(1),
  payeeId: z.string().nullable(),
  displayName: z.string().min(1),
  destination: z.object({
    type: z.literal("EMAIL"),
    value: z.string().email(),
  }),
  amount: MoneySchema,
  note: z.string().max(200).default(""),
  include: z.boolean(),
});

export const PlanFileSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("payout-plan"),
  runId: z.string(),
  parentHash: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .nullable(),
  source: z.object({
    filename: z.string(),
    sha256: z.string(),
    rowCount: z.number().int(),
  }),
  cycleDate: z.string(),
  baseline: z.object({
    payeeMasterVersion: z.number().int(),
    historyWatermark: z.string(),
    policyVersion: z.string(),
  }),
  currency: CurrencySchema,
  lines: z.array(PlanLineSchema),
  totals: z.object({
    includedCount: z.number().int(),
    includedMinor: z.number().int(),
  }),
});

export type PlanFile = z.infer<typeof PlanFileSchema>;
export type PlanLine = z.infer<typeof PlanLineSchema>;

export const FlagSchema = z.object({
  lineId: z.string(),
  ruleId: z.string(),
  severity: z.enum(["INFO", "WARN", "CRITICAL"]),
  blocking: z.boolean(),
  evidence: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
  ),
  relatedLineIds: z.array(z.string()).default([]),
});

export const AnalysisSchema = z.object({
  planHash: z.string(),
  flags: z.array(FlagSchema),
  engineVersions: z.object({
    policy: z.string(),
    erWeights: z.string(),
    esMapping: z.string(),
  }),
});

export type Flag = z.infer<typeof FlagSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

/**
 * Stable line id: L + first 12 hex of sha256(payeeRef|dest|amount|currency|occurrence).
 * `occurrence` is 0-based among identical (payeeRef, destination, amount) rows in file order.
 */
export function makeLineId(args: {
  payeeRef: string;
  destinationValue: string;
  amountMinor: number;
  currency: string;
  occurrence: number;
}): string {
  const material = [
    args.payeeRef,
    args.destinationValue,
    String(args.amountMinor),
    args.currency,
    String(args.occurrence),
  ].join("|");
  const hex = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 12);
  return `L${hex}`;
}
