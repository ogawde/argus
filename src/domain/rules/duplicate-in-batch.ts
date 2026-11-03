import type { Flag } from "../plan";
import { includedLines, type RuleContext } from "./types";

export function ruleDuplicateInBatch(ctx: RuleContext): Flag[] {
  const flags: Flag[] = [];
  const groups = new Map<string, typeof ctx.plan.lines>();

  for (const line of includedLines(ctx.plan)) {
    const key = `${line.payeeRef}|${line.destination.value}|${line.amount.minor}|${line.amount.currency}`;
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = group[0]!;
    for (let i = 1; i < group.length; i++) {
      const line = group[i]!;
      flags.push({
        lineId: line.lineId,
        ruleId: "DUPLICATE_IN_BATCH",
        severity: ctx.policy.duplicateInBatch.severity,
        blocking: ctx.policy.duplicateInBatch.blocking,
        evidence: [
          { key: "payeeRef", label: "Payee ref", value: line.payeeRef },
          { key: "amountMinor", label: "Amount (minor)", value: line.amount.minor },
          { key: "occurrence", label: "Occurrence index", value: i },
        ],
        relatedLineIds: [first.lineId],
      });
    }
  }
  return flags;
}
