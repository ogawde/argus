import type { Flag } from "../plan";
import type { Policy } from "../policy";
import {
  includedLines,
  type BurstRow,
  type RuleContext,
  type VelocityHit,
  type WeeklyRow,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO dates for the burst + baseline windows. All derived from cycleDate, never "now". */
export function velocityWindows(cycleDate: Date, policy: Policy) {
  const { burstDays, lookbackDays } = policy.velocity;
  return {
    cycleStart: cycleDate.toISOString(),
    burstStart: new Date(cycleDate.getTime() - burstDays * DAY_MS).toISOString(),
    lookbackStart: new Date(cycleDate.getTime() - lookbackDays * DAY_MS).toISOString(),
  };
}

/**
 * Turn Q3 (burst counts) + Q2 (weekly baseline) into hits.
 * Hit = recent count >= burstMin AND burst weekly rate >= cadenceMultiplier × historic weekly rate.
 * Historic cadence divides by ALL baseline weeks (not just active weeks), so a monthly payee is ~0.23/week.
 */
export function findVelocityHits(args: {
  burstRows: BurstRow[];
  weeklyRows: WeeklyRow[];
  cycleDate: Date;
  policy: Policy;
}): VelocityHit[] {
  const { burstDays, burstMin, cadenceMultiplier, lookbackDays } = args.policy.velocity;
  const windows = velocityWindows(args.cycleDate, args.policy);
  const baselineWeeks = (lookbackDays - burstDays) / 7;

  const baselineCountByPayee = new Map<string, number>();
  for (const row of args.weeklyRows) {
    baselineCountByPayee.set(
      row.payeeId,
      (baselineCountByPayee.get(row.payeeId) ?? 0) + row.count,
    );
  }

  const hits: VelocityHit[] = [];
  for (const burst of args.burstRows) {
    if (burst.recentCount < burstMin) continue;

    const burstWeeklyRate = burst.recentCount / (burstDays / 7);
    const historicWeeklyCadence = (baselineCountByPayee.get(burst.payeeId) ?? 0) / baselineWeeks;
    if (burstWeeklyRate < cadenceMultiplier * historicWeeklyCadence) continue;

    hits.push({
      payeeId: burst.payeeId,
      recentCount: burst.recentCount,
      recentTotalMinor: burst.recentTotalMinor,
      burstWeeklyRate,
      historicWeeklyCadence,
      burstStart: windows.burstStart,
      cycleStart: windows.cycleStart,
    });
  }
  return hits;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** VELOCITY_SPIKE: payee had a burst of payouts right before the cycle. */
export function ruleVelocitySpike(ctx: RuleContext, hits: VelocityHit[]): Flag[] {
  const hitByPayee = new Map(hits.map((h) => [h.payeeId, h]));
  const { burstDays, burstMin, cadenceMultiplier, severity, blocking } = ctx.policy.velocity;

  const flags: Flag[] = [];
  for (const line of includedLines(ctx.plan)) {
    if (!line.payeeId) continue;
    const hit = hitByPayee.get(line.payeeId);
    if (!hit) continue;

    flags.push({
      lineId: line.lineId,
      ruleId: "VELOCITY_SPIKE",
      severity,
      blocking,
      evidence: [
        { key: "recentCount", label: `Payouts in last ${burstDays} days`, value: hit.recentCount },
        { key: "recentTotalMinor", label: "Recent total (minor)", value: hit.recentTotalMinor },
        { key: "burstDays", label: "Burst window (days)", value: burstDays },
        { key: "burstMin", label: "Burst minimum", value: burstMin },
        { key: "burstWeeklyRate", label: "Burst payouts / week", value: round2(hit.burstWeeklyRate) },
        {
          key: "historicWeeklyCadence",
          label: "Historic payouts / week",
          value: round2(hit.historicWeeklyCadence),
        },
        { key: "cadenceMultiplier", label: "Cadence multiplier", value: cadenceMultiplier },
        { key: "burstStart", label: "Burst window start", value: hit.burstStart },
      ],
      relatedLineIds: [],
    });
  }
  return flags;
}
