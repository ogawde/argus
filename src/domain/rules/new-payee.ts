import type { Flag } from "../plan";
import { percentile } from "../stats";
import { includedLines, type RuleContext } from "./types";

export function ruleNewPayee(ctx: RuleContext): Flag[] {
  const lines = includedLines(ctx.plan);
  const amounts = lines.map((l) => l.amount.minor);
  const p95 = amounts.length ? percentile(amounts, 95) : 0;
  const escalateAt = p95 * ctx.policy.newPayee.escalateAmountVsBatchP95Multiplier;

  const flags: Flag[] = [];
  for (const line of lines) {
    if (line.payeeId !== null) continue;
    const escalate = line.amount.minor > escalateAt && escalateAt > 0;
    const severity = escalate
      ? ctx.policy.newPayee.escalateSeverity
      : ctx.policy.newPayee.defaultSeverity;
    flags.push({
      lineId: line.lineId,
      ruleId: "NEW_PAYEE",
      severity,
      blocking: severity === "CRITICAL",
      evidence: [
        { key: "payeeRef", label: "Payee ref", value: line.payeeRef },
        { key: "amountMinor", label: "Amount (minor)", value: line.amount.minor },
        { key: "batchP95", label: "Batch p95 (minor)", value: p95 },
        { key: "escalated", label: "Escalated vs p95×3", value: escalate },
      ],
      relatedLineIds: [],
    });
  }
  return flags;
}
