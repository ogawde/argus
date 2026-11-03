import type { Flag } from "../plan";
import { daysBetween, includedLines, type RuleContext } from "./types";

export function ruleDormantReactivation(ctx: RuleContext): Flag[] {
  const flags: Flag[] = [];
  const idleDays = ctx.policy.dormantReactivation.idleDays;

  for (const line of includedLines(ctx.plan)) {
    if (!line.payeeId) continue;
    const hist = ctx.historyByPayeeId.get(line.payeeId) ?? [];
    if (hist.length === 0) continue;

    const lastPaid = hist.reduce((a, b) => (a.paidAt > b.paidAt ? a : b));
    const idle = daysBetween(lastPaid.paidAt, ctx.cycleDate);
    if (idle < idleDays) continue;

    flags.push({
      lineId: line.lineId,
      ruleId: "DORMANT_REACTIVATION",
      severity: ctx.policy.dormantReactivation.severity,
      blocking: ctx.policy.dormantReactivation.blocking,
      evidence: [
        { key: "lastPaidAt", label: "Last paid at", value: lastPaid.paidAt.toISOString() },
        { key: "idleDays", label: "Idle days", value: idle },
        { key: "thresholdDays", label: "Threshold days", value: idleDays },
      ],
      relatedLineIds: [],
    });
  }
  return flags;
}
