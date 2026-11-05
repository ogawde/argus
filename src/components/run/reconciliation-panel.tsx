import { Scale } from "lucide-react";
import type { StudioData } from "@/domain/studio-data";
import { formatMoney } from "@/components/run/format";

/** Planned vs. actual after a plan is applied. */
export function ReconciliationPanel({ data }: { data: StudioData }) {
  const { reconciliation, kpis } = data;
  const unclaimed = reconciliation.items.filter((item) => item.status === "UNCLAIMED").length;

  return (
    <section className="flex flex-col gap-2" aria-label="Reconciliation">
      <h3 className="eyebrow flex items-center gap-1.5">
        <Scale className="size-3.5" aria-hidden /> Reconciliation
        {reconciliation.outcome ? (
          <span className="rounded-full border border-rule px-2 py-0.5 text-[10px] tracking-normal text-ink-soft">
            {reconciliation.outcome.replaceAll("_", " ")}
          </span>
        ) : null}
      </h3>
      {reconciliation.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule-strong p-4 text-sm text-ink-faint">{reconciliation.note}</p>
      ) : (
        <div className="rounded-lg border border-rule bg-surface p-3 text-sm">
          <p className="mb-2 text-ink-soft">
            {reconciliation.note}
            {unclaimed > 0 ? ` ${unclaimed} unclaimed.` : ""}
          </p>
          <ul className="divide-y divide-rule">
            {reconciliation.items.slice(0, 12).map((item) => (
              <li key={item.lineId} className="flex justify-between py-1">
                <span className="num text-xs text-ink-faint">{item.lineId}</span>
                <span className={`num text-xs ${item.status === "UNCLAIMED" ? "text-sev-warn" : ""}`}>
                  {formatMoney(item.plannedMinor, kpis.currency)} · {item.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
