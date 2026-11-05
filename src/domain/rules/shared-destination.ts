import type { Flag } from "../plan";
import { destinationFingerprint, normalizeEmail } from "../normalize";
import { includedLines, type RuleContext, type SharedDestinationGroup } from "./types";

/** SHARED_DESTINATION: batch line pays a destination that more than one payee uses. */
export function ruleSharedDestination(
  ctx: RuleContext,
  groups: SharedDestinationGroup[],
): Flag[] {
  const policy = ctx.policy.sharedDestination;
  if (!policy.enabled) return [];

  const groupByFingerprint = new Map(groups.map((g) => [g.destinationFingerprint, g]));
  const lines = includedLines(ctx.plan).map((line) => ({
    line,
    fingerprint: destinationFingerprint(normalizeEmail(line.destination.value).normalized),
  }));

  const flags: Flag[] = [];
  for (const { line, fingerprint } of lines) {
    const group = groupByFingerprint.get(fingerprint);
    if (!group) continue;

    const relatedLineIds = lines
      .filter((o) => o.fingerprint === fingerprint && o.line.lineId !== line.lineId)
      .map((o) => o.line.lineId);

    flags.push({
      lineId: line.lineId,
      ruleId: "SHARED_DESTINATION",
      severity: policy.severity,
      blocking: policy.blocking,
      evidence: [
        { key: "destinationFingerprint", label: "Destination fingerprint", value: fingerprint },
        { key: "payeeCount", label: "Payees sharing destination", value: group.payeeIds.length },
        { key: "payeeIds", label: "Payee ids", value: [...group.payeeIds].sort().join(", ") },
        { key: "batchLineCount", label: "Batch lines to this destination", value: relatedLineIds.length + 1 },
      ],
      relatedLineIds,
    });
  }
  return flags;
}
