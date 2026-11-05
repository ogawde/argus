import { findVelocityHits, velocityWindows } from "@/domain/rules/velocity-spike";
import type {
  BurstRow,
  ElasticRuleInputs,
  SharedDestinationGroup,
  WeeklyRow,
} from "@/domain/rules/types";
import type { Policy } from "@/domain/policy";
import { getElasticClient } from "./client";
import { HISTORY_ALIAS, IDENTITIES_ALIAS } from "./indices";

type EsqlParam = Record<string, string | number | boolean>;
type EsqlCell = string | number | boolean | null | Array<string | number | boolean | null>;

/**
 * Run ES|QL with named params (?name) and return rows as objects.
 * Values only ever go through `params`; the query text is a fixed string.
 */
async function runEsql(query: string, params: EsqlParam[] = []): Promise<Array<Record<string, EsqlCell>>> {
  const es = getElasticClient();
  const res = (await es.esql.query({ query, params, format: "json" })) as unknown as {
    columns: Array<{ name: string }>;
    values: EsqlCell[][];
  };
  return res.values.map((row) =>
    Object.fromEntries(res.columns.map((col, i) => [col.name, row[i] ?? null])),
  );
}

function asNumber(value: EsqlCell | undefined): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function asString(value: EsqlCell | undefined): string {
  return String(value ?? "");
}

// ---- Q1: per-payee baseline -------------------------------------------------

export interface PayeeBaselineRow {
  n: number;
  median: number | null;
  mad: number | null;
  p95: number | null;
  lastPaidAt: string | null;
}

/**
 * Q1 — baseline for one payee from ES. MEDIAN / MEDIAN_ABSOLUTE_DEVIATION / PERCENTILE
 * are approximate (t-digest), so AMOUNT_DEVIATION keeps using the exact TS stats.
 */
export async function queryPayeeBaseline(payeeId: string, cycleStart: Date): Promise<PayeeBaselineRow> {
  const rows = await runEsql(
    `FROM ${HISTORY_ALIAS}
| WHERE payee_id == ?payee_id AND paid_at < ?cycle_start
| STATS n = COUNT(*), med = MEDIAN(amount_minor), mad = MEDIAN_ABSOLUTE_DEVIATION(amount_minor),
        p95 = PERCENTILE(amount_minor, 95), last_paid = MAX(paid_at)`,
    [{ payee_id: payeeId }, { cycle_start: cycleStart.toISOString() }],
  );
  const row = rows[0] ?? {};
  const n = asNumber(row.n);
  return {
    n,
    median: n > 0 ? asNumber(row.med) : null,
    mad: n > 0 ? asNumber(row.mad) : null,
    p95: n > 0 ? asNumber(row.p95) : null,
    lastPaidAt: row.last_paid ? asString(row.last_paid) : null,
  };
}

// ---- Q3: recent burst per payee --------------------------------------------

// Fixed query text. The dashboard shows these same strings in its ES|QL evidence panel.

/** Q3 — payouts per payee inside the burst window. */
export const ESQL_BURST_QUERY = `FROM ${HISTORY_ALIAS}
| WHERE paid_at >= ?burst_start AND paid_at < ?cycle_start
| STATS recent_n = COUNT(*), recent_total = SUM(amount_minor) BY payee_id
| WHERE recent_n >= ?burst_min
| SORT payee_id
| LIMIT 10000`;

/** Q4 — destinations used by more than one payee. */
export const ESQL_SHARED_QUERY = `FROM ${IDENTITIES_ALIAS}
| STATS payees = COUNT_DISTINCT(payee_id), payee_ids = VALUES(payee_id) BY destination_fingerprint
| WHERE payees > 1
| SORT destination_fingerprint
| LIMIT 10000`;


export async function queryBurstRows(args: {
  burstStart: string;
  cycleStart: string;
  burstMin: number;
}): Promise<BurstRow[]> {
  const rows = await runEsql(
    ESQL_BURST_QUERY,
    [{ burst_start: args.burstStart }, { cycle_start: args.cycleStart }, { burst_min: args.burstMin }],
  );
  return rows.map((r) => ({
    payeeId: asString(r.payee_id),
    recentCount: asNumber(r.recent_n),
    recentTotalMinor: asNumber(r.recent_total),
  }));
}

// ---- Q2: weekly baseline (before the burst window) --------------------------

/** Only asks about the payees that already had a burst, so the result stays small. */
export async function queryWeeklyBaseline(args: {
  payeeIds: string[];
  lookbackStart: string;
  burstStart: string;
}): Promise<WeeklyRow[]> {
  if (args.payeeIds.length === 0) return [];

  const idParams: EsqlParam[] = args.payeeIds.map((id, i) => ({ [`payee_${i}`]: id }));
  const idPlaceholders = args.payeeIds.map((_, i) => `?payee_${i}`).join(", ");

  const rows = await runEsql(
    `FROM ${HISTORY_ALIAS}
| WHERE paid_at >= ?lookback_start AND paid_at < ?burst_start AND payee_id IN (${idPlaceholders})
| EVAL week = DATE_TRUNC(1 week, paid_at)
| STATS n = COUNT(*), total = SUM(amount_minor) BY payee_id, week
| SORT payee_id, week
| LIMIT 10000`,
    [{ lookback_start: args.lookbackStart }, { burst_start: args.burstStart }, ...idParams],
  );
  return rows.map((r) => ({
    payeeId: asString(r.payee_id),
    week: asString(r.week),
    count: asNumber(r.n),
    totalMinor: asNumber(r.total),
  }));
}

// ---- Q4: shared destinations -----------------------------------------------

export async function querySharedDestinations(): Promise<SharedDestinationGroup[]> {
  const rows = await runEsql(ESQL_SHARED_QUERY);
  return rows.map((r) => ({
    destinationFingerprint: asString(r.destination_fingerprint),
    payeeIds: (Array.isArray(r.payee_ids) ? r.payee_ids : [r.payee_ids]).map(asString).sort(),
  }));
}

// ---- Entry point for planning ----------------------------------------------

/**
 * Run Q2/Q3/Q4 for one cycle. Pass the result to `runPhase3ElasticRules(ctx, inputs)`.
 * Windows come from `cycleDate` + policy, never from the clock.
 */
export async function fetchElasticRuleInputs(
  cycleDate: Date,
  policy: Policy,
): Promise<ElasticRuleInputs> {
  const windows = velocityWindows(cycleDate, policy);

  const [burstRows, sharedDestinations] = await Promise.all([
    queryBurstRows({
      burstStart: windows.burstStart,
      cycleStart: windows.cycleStart,
      burstMin: policy.velocity.burstMin,
    }),
    policy.sharedDestination.enabled ? querySharedDestinations() : Promise.resolve([]),
  ]);

  const weeklyRows = await queryWeeklyBaseline({
    payeeIds: burstRows.map((r) => r.payeeId),
    lookbackStart: windows.lookbackStart,
    burstStart: windows.burstStart,
  });

  return {
    velocityHits: findVelocityHits({ burstRows, weeklyRows, cycleDate, policy }),
    sharedDestinations,
  };
}
