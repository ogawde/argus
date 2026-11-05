import { Database } from "lucide-react";
import type { EvidenceItem, StudioData } from "@/domain/studio-data";
import { evidenceValue } from "@/components/run/evidence-format";

const KEYWORD = /^(FROM|WHERE|STATS|BY|SORT|LIMIT|EVAL|AND|OR|IN)$/;
const SPLIT = /(\?[a-z_]+|\b(?:FROM|WHERE|STATS|BY|SORT|LIMIT|EVAL|AND|OR|IN)\b)/g;

/** Tiny highlighter: keywords teal, ?params amber. Good enough for a read-only panel. */
function HighlightedQuery({ query }: { query: string }) {
  return (
    <pre className="num overflow-x-auto rounded-md bg-ink px-3 py-2.5 text-[0.75rem] leading-relaxed text-paper">
      {query.split("\n").map((line, lineIndex) => (
        <div key={lineIndex}>
          {line.split(SPLIT).map((part, i) => {
            if (part.startsWith("?")) return <span key={i} className="text-[#f2c46d]">{part}</span>;
            if (KEYWORD.test(part)) return <span key={i} className="font-semibold text-[#6fd3c6]">{part}</span>;
            return <span key={i}>{part}</span>;
          })}
        </div>
      ))}
    </pre>
  );
}

function ResultTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="divide-y divide-rule rounded-md border border-rule bg-surface text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 px-2.5 py-1">
          <dt className="num text-ink-faint">{label}</dt>
          <dd className="num break-all text-right text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Shows the ES|QL behind a velocity or shared-destination flag, with the row it returned. */
export function EsqlPanel({
  ruleId,
  evidence,
  esql,
  cycleDate,
}: {
  ruleId: string;
  evidence: EvidenceItem[];
  esql: StudioData["esql"];
  cycleDate: string;
}) {
  const isVelocity = ruleId === "VELOCITY_SPIKE";
  const isShared = ruleId === "SHARED_DESTINATION";
  if (!isVelocity && !isShared) return null;

  const value = (key: string) => String(evidenceValue(evidence, key) ?? "—");

  const query = isVelocity ? esql.velocity : esql.sharedDestination;
  const params: Array<[string, string]> = isVelocity
    ? [
        ["?burst_start", value("burstStart")],
        ["?cycle_start", `${cycleDate}T00:00:00Z`],
        ["?burst_min", value("burstMin")],
      ]
    : [];
  const result: Array<[string, string]> = isVelocity
    ? [
        ["recent_n", value("recentCount")],
        ["recent_total (minor)", value("recentTotalMinor")],
        ["burst payouts / week", value("burstWeeklyRate")],
        ["usual payouts / week", value("historicWeeklyCadence")],
      ]
    : [
        ["destination_fingerprint", value("destinationFingerprint")],
        ["payees", value("payeeCount")],
        ["payee_ids", value("payeeIds")],
      ];

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-rule bg-surface p-3" aria-label="ES|QL evidence">
      <h4 className="eyebrow flex items-center gap-1.5">
        <Database className="size-3.5" aria-hidden /> Elasticsearch · ES|QL
      </h4>
      <HighlightedQuery query={query} />
      {params.length > 0 ? <ResultTable rows={params} /> : null}
      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-faint">Row returned for this payee</p>
      <ResultTable rows={result} />
    </section>
  );
}
