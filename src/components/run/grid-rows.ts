import {
  BATCH_LINE_ID,
  type LineMarker,
  type Severity,
  type StudioData,
  type StudioFlag,
  type StudioLine,
} from "@/domain/studio-data";
import { ruleTitle, severityRank } from "@/components/run/rule-meta";

export type RowStatus = "open" | "accepted" | "excluded" | "clean";

/** One row of the review grid: one flag on one line, or a line with no flags. */
export interface GridRow {
  /** stable id: "lineId|ruleId" or "lineId|-" for clean lines */
  key: string;
  lineId: string;
  ruleId: string | null;
  ruleTitle: string;
  severity: Severity | null;
  severityRank: number;
  blocking: boolean;
  marker: LineMarker;
  sourceRow: number | null;
  payeeRef: string;
  name: string;
  destination: string;
  amountMinor: number;
  deltaMinor: number | null;
  status: RowStatus;
  flag: StudioFlag | null;
  line: StudioLine | null;
}

export type GridView = "flags" | "open" | "all";

export function rowKey(lineId: string, ruleId: string | null): string {
  return `${lineId}|${ruleId ?? "-"}`;
}

/** Turn the studio-data document into flat rows for AG Grid. */
export function buildGridRows(data: StudioData): GridRow[] {
  const lineById = new Map(data.lines.map((l) => [l.lineId, l]));
  const flaggedLineIds = new Set<string>();
  const rows: GridRow[] = [];

  for (const flag of data.flags) {
    flaggedLineIds.add(flag.lineId);
    const line = lineById.get(flag.lineId) ?? null;
    const isBatch = flag.lineId === BATCH_LINE_ID;
    let status: RowStatus = "open";
    if (flag.disposition?.action === "ACCEPTED") status = "accepted";
    if (flag.disposition?.action === "EXCLUDED") status = "excluded";

    rows.push({
      key: rowKey(flag.lineId, flag.ruleId),
      lineId: flag.lineId,
      ruleId: flag.ruleId,
      ruleTitle: ruleTitle(flag.ruleId),
      severity: flag.severity,
      severityRank: severityRank(flag.severity),
      blocking: flag.blocking,
      marker: line?.marker ?? "same",
      sourceRow: line?.sourceRow ?? null,
      payeeRef: isBatch ? "—" : (line?.payeeRef ?? "?"),
      name: isBatch ? "Whole batch" : (line?.displayName ?? flag.lineId),
      destination: isBatch ? "all payees" : (line?.destination ?? ""),
      amountMinor: isBatch ? data.kpis.includedMinor : (line?.amountMinor ?? 0),
      deltaMinor: isBatch ? data.kpis.deltaVsLastCycleMinor : (line?.deltaMinor ?? null),
      status,
      flag,
      line,
    });
  }

  for (const line of data.lines) {
    if (flaggedLineIds.has(line.lineId)) continue;
    rows.push({
      key: rowKey(line.lineId, null),
      lineId: line.lineId,
      ruleId: null,
      ruleTitle: "",
      severity: null,
      severityRank: 0,
      blocking: false,
      marker: line.marker,
      sourceRow: line.sourceRow,
      payeeRef: line.payeeRef,
      name: line.displayName,
      destination: line.destination,
      amountMinor: line.amountMinor,
      deltaMinor: line.deltaMinor,
      status: line.include ? "clean" : "excluded",
      flag: null,
      line,
    });
  }

  return rows;
}

export interface GridFilters {
  view: GridView;
  severities: Severity[];
  ruleId: string;
  search: string;
}

export function filterGridRows(rows: GridRow[], filters: GridFilters): GridRow[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.view === "flags" && !row.flag) return false;
    if (filters.view === "open" && row.status !== "open") return false;
    if (filters.severities.length > 0 && (!row.severity || !filters.severities.includes(row.severity))) {
      return false;
    }
    if (filters.ruleId && row.ruleId !== filters.ruleId) return false;
    if (search) {
      const haystack = `${row.name} ${row.payeeRef} ${row.destination} ${row.ruleTitle}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/** Default order: worst severity first, then file order. */
export function sortGridRows(rows: GridRow[]): GridRow[] {
  return [...rows].sort(
    (a, b) => b.severityRank - a.severityRank || (a.sourceRow ?? 0) - (b.sourceRow ?? 0),
  );
}
