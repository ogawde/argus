import type { Flag } from "../plan";
import { median, robustZ } from "../stats";
import { includedLines, type RuleContext } from "./types";

export function ruleAmountDeviation(ctx: RuleContext): Flag[] {
  const flags: Flag[] = [];
  const { criticalZScore, warnZScore, absoluteMultipleOfMedian } =
    ctx.policy.amountDeviation;

  for (const line of includedLines(ctx.plan)) {
    if (!line.payeeId) continue;
    const hist = (ctx.historyByPayeeId.get(line.payeeId) ?? [])
      .filter((h) => h.currency === line.amount.currency)
      .map((h) => h.amountMinor);
    if (hist.length < 2) continue;

    const med = median(hist);
    const z = robustZ(line.amount.minor, hist);
    const absMultiple = med > 0 && line.amount.minor >= absoluteMultipleOfMedian * med;
    const absZ = Math.abs(z);

    let severity: "WARN" | "CRITICAL" | null = null;
    if (absZ > criticalZScore || absMultiple) severity = "CRITICAL";
    else if (absZ > warnZScore) severity = "WARN";
    if (!severity) continue;

    flags.push({
      lineId: line.lineId,
      ruleId: "AMOUNT_DEVIATION",
      severity,
      blocking: severity === "CRITICAL",
      evidence: [
        { key: "amountMinor", label: "Amount (minor)", value: line.amount.minor },
        { key: "medianMinor", label: "Historical median", value: med },
        { key: "robustZ", label: "Robust z", value: Number.isFinite(z) ? Number(z.toFixed(3)) : z },
        { key: "absMultiple", label: "≥10× median", value: absMultiple },
        { key: "historyCount", label: "History n", value: hist.length },
      ],
      relatedLineIds: [],
    });
  }
  return flags;
}
