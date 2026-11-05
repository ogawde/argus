import type { Severity } from "@/domain/studio-data";
import { cn } from "@/lib/utils";
import { SEVERITY_LABEL, SEVERITY_STYLE } from "@/components/run/rule-meta";

/** Small colored pill: Critical / Warning / Info. The text always says it, color is only a hint. */
export function SeverityChip({ severity, className }: { severity: Severity; className?: string }) {
  const style = SEVERITY_STYLE[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide",
        style.chip,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
