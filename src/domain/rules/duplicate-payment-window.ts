import type { Flag } from "../plan";
import { includedLines, type RuleContext } from "./types";

/** Same payee + same amount already paid this calendar cycle (history only in Phase 2). */
export function ruleDuplicatePaymentWindow(ctx: RuleContext): Flag[] {
  const flags: Flag[] = [];
  const cycleStart = new Date(ctx.cycleDate);
  cycleStart.setUTCHours(0, 0, 0, 0);
  const cycleEnd = new Date(cycleStart);
  cycleEnd.setUTCMonth(cycleEnd.getUTCMonth() + 1);

  for (const line of includedLines(ctx.plan)) {
    if (!line.payeeId) continue;
    const hist = ctx.historyByPayeeId.get(line.payeeId) ?? [];
    const hit = hist.find(
      (h) =>
        h.amountMinor === line.amount.minor &&
        h.currency === line.amount.currency &&
        h.paidAt >= cycleStart &&
        h.paidAt < cycleEnd,
    );
    const other = (ctx.otherRunItems ?? []).find(
      (item) =>
        item.payeeId === line.payeeId &&
        item.amountMinor === line.amount.minor &&
        item.currency === line.amount.currency,
    );
    if (!hit && !other) continue;

    flags.push({
      lineId: line.lineId,
      ruleId: "DUPLICATE_PAYMENT_WINDOW",
      severity: ctx.policy.duplicatePaymentWindow.severity,
      blocking: ctx.policy.duplicatePaymentWindow.blocking,
      evidence: [
        { key: "amountMinor", label: "Amount (minor)", value: line.amount.minor },
        {
          key: "priorPaidAt",
          label: "Prior paid at",
          value: hit ? hit.paidAt.toISOString() : "other-run",
        },
        {
          key: "priorBatchRef",
          label: "Prior batch",
          value: hit?.batchRef ?? other?.runId ?? "",
        },
      ],
      relatedLineIds: [],
    });
  }
  return flags;
}
