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
  /** Other non-failed runs' payout items (Phase 5 cross-run window). */
  otherRunItems?: Array<{
    payeeId: string;
    amountMinor: number;
    currency: string;
    runId: string;
  }>;
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

// ---- Phase 3: rows that come back from Elasticsearch (ES|QL) ----

/** Q3 row: payouts per payee inside the burst window. */
export interface BurstRow {
  payeeId: string;
  recentCount: number;
  recentTotalMinor: number;
}

/** Q2 row: payouts per payee per week in the baseline window (before the burst window). */
export interface WeeklyRow {
  payeeId: string;
  /** ISO start of the week (ES DATE_TRUNC 1 week) */
  week: string;
  count: number;
  totalMinor: number;
}

export interface VelocityHit {
  payeeId: string;
  recentCount: number;
  recentTotalMinor: number;
  /** payouts per week inside the burst window */
  burstWeeklyRate: number;
  /** payouts per week across the baseline window */
  historicWeeklyCadence: number;
  burstStart: string;
  cycleStart: string;
}

/** Q4 row: one destination used by more than one payee. */
export interface SharedDestinationGroup {
  destinationFingerprint: string;
  payeeIds: string[];
}

/** Everything planning gets from Elastic and hands to the Phase 3 rules. */
export interface ElasticRuleInputs {
  velocityHits: VelocityHit[];
  sharedDestinations: SharedDestinationGroup[];
}
