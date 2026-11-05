import type { Severity } from "@/domain/studio-data";

/** Human titles for rule ids, plus a one-line explanation shown in the evidence panel. */
export const RULE_META: Record<string, { title: string; blurb: string }> = {
  NEW_PAYEE: {
    title: "New payee",
    blurb: "This payee is not in the payee master yet.",
  },
  DESTINATION_CHANGED: {
    title: "Destination changed",
    blurb: "The payout destination was changed shortly before this cycle.",
  },
  AMOUNT_DEVIATION: {
    title: "Unusual amount",
    blurb: "The amount is far from what this payee normally gets.",
  },
  DUPLICATE_IN_BATCH: {
    title: "Duplicate in batch",
    blurb: "The same payee and amount appear more than once in this file.",
  },
  DUPLICATE_PAYMENT_WINDOW: {
    title: "Recent duplicate",
    blurb: "A matching payout already went out inside the duplicate window.",
  },
  DORMANT_REACTIVATION: {
    title: "Dormant payee",
    blurb: "This payee has not been paid for a long time.",
  },
  BATCH_TOTAL_DEVIATION: {
    title: "Batch total off",
    blurb: "The whole batch is much larger or smaller than previous cycles.",
  },
  VELOCITY_SPIKE: {
    title: "Payout velocity",
    blurb: "Many payouts in a short burst compared with this payee's usual cadence.",
  },
  SHARED_DESTINATION: {
    title: "Shared destination",
    blurb: "More than one payee is paid to the same destination.",
  },
  ENTITY_MATCH: {
    title: "Possible same person",
    blurb: "A new payee looks very similar to an established one.",
  },
};

export function ruleTitle(ruleId: string): string {
  return RULE_META[ruleId]?.title ?? ruleId;
}

export const SEVERITY_ORDER: Severity[] = ["CRITICAL", "WARN", "INFO"];

export function severityRank(severity: Severity | null): number {
  if (severity === "CRITICAL") return 3;
  if (severity === "WARN") return 2;
  if (severity === "INFO") return 1;
  return 0;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  CRITICAL: "Critical",
  WARN: "Warning",
  INFO: "Info",
};

/** Tailwind classes per severity (colors come from the shared tokens). */
export const SEVERITY_STYLE: Record<Severity, { chip: string; dot: string; bar: string }> = {
  CRITICAL: {
    chip: "border-sev-critical/30 bg-sev-critical-wash text-sev-critical",
    dot: "bg-sev-critical",
    bar: "bg-sev-critical",
  },
  WARN: {
    chip: "border-sev-warn/30 bg-sev-warn-wash text-sev-warn",
    dot: "bg-sev-warn",
    bar: "bg-sev-warn",
  },
  INFO: {
    chip: "border-sev-info/30 bg-sev-info-wash text-sev-info",
    dot: "bg-sev-info",
    bar: "bg-sev-info",
  },
};
