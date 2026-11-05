import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "border-rule-strong bg-paper-deep text-ink-soft",
  PLANNING: "border-sev-info/30 bg-sev-info-wash text-sev-info",
  FLAGGED: "border-sev-warn/30 bg-sev-warn-wash text-sev-warn",
  READY: "border-teal/40 bg-teal-wash text-teal-deep",
  APPROVED: "border-ok/30 bg-ok-wash text-ok",
  APPLYING: "border-sev-info/30 bg-sev-info-wash text-sev-info",
  RECONCILED: "border-ok/40 bg-ok-wash text-ok",
  REJECTED: "border-sev-critical/30 bg-sev-critical-wash text-sev-critical",
  FAILED: "border-sev-critical/30 bg-sev-critical-wash text-sev-critical",
};

/** Run status as a small pill. Server-safe (no hooks). */
export function StatusChip({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wider",
        STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT,
        className,
      )}
    >
      {status}
    </span>
  );
}
