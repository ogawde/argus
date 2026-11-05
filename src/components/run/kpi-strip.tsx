import type { StudioData } from "@/domain/studio-data";
import { cn } from "@/lib/utils";
import { formatMoney, formatSignedMoney, plural } from "@/components/run/format";
import { SEVERITY_ORDER, SEVERITY_LABEL, SEVERITY_STYLE } from "@/components/run/rule-meta";

/** Four big numbers separated by rules. Deliberately not four cards. */
export function KpiStrip({ data }: { data: StudioData }) {
  const { kpis, planDiff } = data;
  const hasPlan = data.planHash !== null;

  return (
    <dl className="grid grid-cols-2 divide-x divide-rule border-b border-rule lg:grid-cols-4">
      <Kpi
        label="Lines in plan"
        value={hasPlan ? `${kpis.includedCount}` : "—"}
        suffix={hasPlan ? `of ${kpis.lineCount}` : undefined}
        note={
          hasPlan
            ? kpis.excludedCount > 0
              ? `${plural(kpis.excludedCount, "line")} excluded`
              : "none excluded"
            : "Start planning to see lines"
        }
      />
      <Kpi
        label="Included total"
        value={hasPlan ? formatMoney(kpis.includedMinor, kpis.currency) : "—"}
        note={
          planDiff.parentHash
            ? `${formatSignedMoney(planDiff.deltaIncludedMinor, kpis.currency)} since previous plan`
            : "first plan revision"
        }
        noteTone={planDiff.deltaIncludedMinor < 0 ? "good" : "plain"}
      />
      <div className="px-5 py-4 sm:px-8">
        <dt className="eyebrow">Flagged</dt>
        <dd className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-4xl font-semibold text-ink">{hasPlan ? kpis.flagged.total : "—"}</span>
          {hasPlan ? <span className="text-sm text-ink-soft">on {plural(kpis.flagged.distinctLines, "line")}</span> : null}
        </dd>
        {hasPlan ? (
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
            {SEVERITY_ORDER.map((severity) => (
              <li key={severity} className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", SEVERITY_STYLE[severity].dot)} aria-hidden />
                <span className="num font-semibold text-ink">{kpis.flagged[severity]}</span>
                {SEVERITY_LABEL[severity].toLowerCase()}
              </li>
            ))}
            <li className="font-medium text-ink">{kpis.flagged.open} open</li>
          </ul>
        ) : null}
      </div>
      <Kpi
        label="Change vs last cycle"
        value={
          hasPlan && kpis.deltaVsLastCyclePct !== null
            ? `${kpis.deltaVsLastCyclePct > 0 ? "+" : kpis.deltaVsLastCyclePct < 0 ? "−" : ""}${Math.abs(kpis.deltaVsLastCyclePct)}%`
            : "—"
        }
        note={
          hasPlan && kpis.lastCycle && kpis.deltaVsLastCycleMinor !== null
            ? `${formatSignedMoney(kpis.deltaVsLastCycleMinor, kpis.currency)} vs ${kpis.lastCycle.batchRef} (${formatMoney(kpis.lastCycle.totalMinor, kpis.currency)})`
            : "no earlier cycle to compare"
        }
      />
    </dl>
  );
}

function Kpi({
  label,
  value,
  suffix,
  note,
  noteTone = "plain",
}: {
  label: string;
  value: string;
  suffix?: string;
  note: string;
  noteTone?: "plain" | "good";
}) {
  return (
    <div className="px-5 py-4 sm:px-8">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-4xl font-semibold text-ink">{value}</span>
        {suffix ? <span className="text-sm text-ink-soft">{suffix}</span> : null}
      </dd>
      <p className={cn("mt-1.5 text-xs", noteTone === "good" ? "text-teal-deep" : "text-ink-soft")}>{note}</p>
    </div>
  );
}
