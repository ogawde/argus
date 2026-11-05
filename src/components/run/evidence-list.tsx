import type { EvidenceItem } from "@/domain/studio-data";
import { cn } from "@/lib/utils";
import { formatEvidenceValue, listableEvidence } from "@/components/run/evidence-format";

/** Plain evidence key/value list. Keys the AI rationale cited are highlighted. */
export function EvidenceList({
  items,
  currency,
  citedKeys,
}: {
  items: EvidenceItem[];
  currency: string;
  citedKeys: string[];
}) {
  const rows = listableEvidence(items);
  if (rows.length === 0) return null;

  return (
    <dl className="divide-y divide-rule rounded-lg border border-rule bg-surface text-sm">
      {rows.map((item) => {
        const isCited = citedKeys.includes(item.key);
        return (
          <div
            key={item.key}
            className={cn("flex items-baseline justify-between gap-4 px-3 py-1.5", isCited && "bg-teal-wash/70")}
          >
            <dt className="flex items-center gap-1.5 text-ink-soft">
              {item.label}
              {isCited ? (
                <span className="rounded bg-teal px-1 text-[0.5625rem] font-bold uppercase tracking-wider text-primary-foreground">
                  cited
                </span>
              ) : null}
            </dt>
            <dd className="num max-w-[60%] break-words text-right text-ink">{formatEvidenceValue(item, currency)}</dd>
          </div>
        );
      })}
    </dl>
  );
}
