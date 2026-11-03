import { destinationFingerprint } from "../normalize";
import type { Flag } from "../plan";
import { daysBetween, includedLines, type RuleContext } from "./types";

export function ruleDestinationChanged(ctx: RuleContext): Flag[] {
  const flags: Flag[] = [];
  const windowDays = ctx.policy.destinationChanged.windowDays;

  for (const line of includedLines(ctx.plan)) {
    if (!line.payeeId) continue;
    const payee = ctx.payeeByRef.get(line.payeeRef);
    if (!payee) continue;

    const lineFp = destinationFingerprint(line.destination.value);
    if (lineFp === payee.destinationFingerprint) continue;

    const changedAt = payee.destinationChangedAt;
    if (!changedAt) continue;
    const daysBefore = daysBetween(changedAt, ctx.cycleDate);
    if (daysBefore < 0 || daysBefore > windowDays) continue;

    flags.push({
      lineId: line.lineId,
      ruleId: "DESTINATION_CHANGED",
      severity: ctx.policy.destinationChanged.severity,
      blocking: ctx.policy.destinationChanged.blocking,
      evidence: [
        { key: "previousDestination", label: "Previous destination", value: payee.destinationValue },
        { key: "newDestination", label: "New destination", value: line.destination.value },
        { key: "changedAt", label: "Changed at", value: changedAt.toISOString() },
        { key: "daysBeforeCycle", label: "Days before cycle", value: daysBefore },
      ],
      relatedLineIds: [],
    });
  }
  return flags;
}
