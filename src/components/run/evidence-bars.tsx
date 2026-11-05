import type { EvidenceItem } from "@/domain/studio-data";
import { cn } from "@/lib/utils";
import { ER_BAR_KEYS, evidenceValue } from "@/components/run/evidence-format";

const BAR_LABEL: Record<string, string> = {
  "er.vector": "Embedding similarity",
  "er.fuzzyName": "Fuzzy name match",
  "er.emailLocal": "Email local-part",
  "er.sameDestination": "Same destination",
  "er.context.sameAmount": "Same amount this cycle",
};

/** 0..1 from a number or a boolean. */
function toScore(value: EvidenceItem["value"] | undefined): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = typeof value === "number" ? value : Number(value);
  if (value === undefined || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/** Entity-resolution evidence as horizontal bars, plus the overall match score. */
export function EvidenceBars({ items, citedKeys }: { items: EvidenceItem[]; citedKeys: string[] }) {
  const bars = ER_BAR_KEYS.map((key) => ({ key, score: toScore(evidenceValue(items, key)) })).filter(
    (bar) => bar.score !== null,
  );
  if (bars.length === 0) return null;

  const total = toScore(evidenceValue(items, "er.score"));
  const band = evidenceValue(items, "er.band");

  return (
    <div className="rounded-lg border border-rule bg-surface p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="eyebrow">Why these two look alike</h4>
        {total !== null ? (
          <span className="text-xs text-ink-soft">
            Match score <strong className="num text-ink">{total.toFixed(2)}</strong>
            {band ? <span className="ml-1 text-ink-faint">· {String(band)}</span> : null}
          </span>
        ) : null}
      </div>
      <ul className="flex flex-col gap-2">
        {bars.map(({ key, score }) => {
          const isCited = citedKeys.includes(key);
          const percent = Math.round((score ?? 0) * 100);
          return (
            <li key={key} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-2 text-xs">
              <span className={cn("text-ink-soft", isCited && "font-semibold text-teal-deep")}>
                {BAR_LABEL[key]}
                {isCited ? " ✓" : ""}
              </span>
              <span
                role="meter"
                aria-label={BAR_LABEL[key]}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={score ?? 0}
                className="h-2.5 overflow-hidden rounded-full bg-paper-deep"
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    isCited ? "bg-teal" : "bg-teal/60",
                    percent >= 85 && "bg-teal-deep",
                  )}
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span className="num text-right text-ink">{(score ?? 0).toFixed(2)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
