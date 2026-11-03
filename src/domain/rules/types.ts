import type { Flag, PlanFile, PlanLine } from "../plan";
import type { Policy } from "../policy";

export interface HistoricalPayoutView {
  payeeId: string;
  destinationFingerprint: string;
  amountMinor: number;
  currency: string;
  paidAt: Date;
  batchRef: string;
}

export interface PayeeView {
  id: string;
  destinationValue: string;
  destinationFingerprint: string;
  destinationChangedAt: Date | null;
  createdAt: Date;
}

export interface RuleContext {
  plan: PlanFile;
  policy: Policy;
  cycleDate: Date;
  /** payeeId → history (any currency matching plan) */
  historyByPayeeId: Map<string, HistoricalPayoutView[]>;
  /** payeeRef → payee master row when known */
  payeeByRef: Map<string, PayeeView>;
  /** Prior batch totals (includedMinor) for BATCH_TOTAL_DEVIATION */
  priorBatchTotalsMinor: number[];
  /** fingerprint helper already applied on plan destinations */
}

export type RuleFn = (ctx: RuleContext) => Flag[];

export function daysBetween(earlier: Date, later: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function includedLines(plan: PlanFile): PlanLine[] {
  return plan.lines.filter((l) => l.include);
}
