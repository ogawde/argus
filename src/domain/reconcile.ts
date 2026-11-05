const TERMINAL = new Set([
  "SUCCESS",
  "FAILED",
  "DENIED",
  "BLOCKED",
  "UNCLAIMED",
  "RETURNED",
  "REFUNDED",
  "CANCELED",
  "CANCELLED",
]);

/** A later status may replace an earlier one. A terminal status never moves backwards. */
export function canAdvanceStatus(from: string, to: string): boolean {
  if (from === to) return false;
  if (TERMINAL.has(from)) return false;
  return true;
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

export interface ReconcilePlanLine {
  lineId: string;
  senderItemId: string;
  amountMinor: number;
  include: boolean;
}

export interface ReconcileItem {
  senderItemId: string;
  lineId: string;
  amountMinor: number;
  status: string;
}

export interface ReconcileReport {
  outcome: "CLEAN" | "WITH_EXCEPTIONS" | "FAILED";
  settled: boolean;
  matched: number;
  missing: string[];
  unexpected: string[];
  amountMismatch: string[];
  statusCounts: Record<string, number>;
}

/**
 * Compare included plan lines to payout items.
 * CLEAN only when every included line is SUCCESS and amounts match.
 */
export function reconcile(
  lines: ReconcilePlanLine[],
  items: ReconcileItem[],
  batchStatus?: string,
): ReconcileReport {
  const included = lines.filter((line) => line.include);
  const bySender = new Map(items.map((item) => [item.senderItemId, item]));
  const plannedIds = new Set(included.map((line) => line.senderItemId));
  const missing: string[] = [];
  const amountMismatch: string[] = [];
  const statusCounts: Record<string, number> = {};
  let matched = 0;

  for (const line of included) {
    const item = bySender.get(line.senderItemId);
    if (!item) {
      missing.push(line.lineId);
      continue;
    }
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
    if (item.amountMinor !== line.amountMinor) amountMismatch.push(line.lineId);
    else matched += 1;
  }

  const unexpected = items
    .filter((item) => !plannedIds.has(item.senderItemId))
    .map((item) => item.senderItemId);

  const settled =
    batchStatus === "DENIED" ||
    batchStatus === "SUCCESS" ||
    (missing.length === 0 && included.every((line) => isTerminalStatus(bySender.get(line.senderItemId)?.status ?? "")));

  if (batchStatus === "DENIED") {
    return { outcome: "FAILED", settled: true, matched, missing, unexpected, amountMismatch, statusCounts };
  }

  const allSuccess =
    missing.length === 0 &&
    unexpected.length === 0 &&
    amountMismatch.length === 0 &&
    included.length > 0 &&
    included.every((line) => bySender.get(line.senderItemId)?.status === "SUCCESS");

  return {
    outcome: allSuccess ? "CLEAN" : "WITH_EXCEPTIONS",
    settled,
    matched,
    missing,
    unexpected,
    amountMismatch,
    statusCounts,
  };
}
