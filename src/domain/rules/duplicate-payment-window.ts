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
    if (!hit) continue;

    flags.push({
      lineId: line.lineId,
      ruleId: "DUPLICATE_PAYMENT_WINDOW",
      severity: ctx.policy.duplicatePaymentWindow.severity,
      blocking: ctx.policy.duplicatePaymentWindow.blocking,
      evidence: [
        { key: "amountMinor", label: "Amount (minor)", value: line.amount.minor },
        { key: "priorPaidAt", label: "Prior paid at", value: hit.paidAt.toISOString() },
        { key: "priorBatchRef", label: "Prior batch", value: hit.batchRef },
      ],
      relatedLineIds: [],
    });
  }
  return flags;
}
