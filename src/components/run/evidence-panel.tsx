"use client";

import { Check, X } from "lucide-react";
import { BATCH_LINE_ID, type StudioData } from "@/domain/studio-data";
import { Button } from "@/components/ui/button";
import { EsqlPanel } from "@/components/run/esql-panel";
import { EvidenceBars } from "@/components/run/evidence-bars";
import { EvidenceList } from "@/components/run/evidence-list";
import { formatDateTime, formatMoney, formatSignedMoney } from "@/components/run/format";
import type { GridRow } from "@/components/run/grid-rows";
import { IdentityCompare } from "@/components/run/identity-compare";
import { RationaleBlock } from "@/components/run/rationale-block";
import { RULE_META } from "@/components/run/rule-meta";
import { SeverityChip } from "@/components/run/severity-chip";
import { VelocityChart } from "@/components/run/velocity-chart";

interface EvidencePanelProps {
  data: StudioData;
  row: GridRow | null;
  canEdit: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onAction: (row: GridRow, action: "ACCEPTED" | "EXCLUDED") => void;
}

/** Right-hand evidence drawer for the selected grid row. */
export function EvidencePanel({ data, row, canEdit, headingRef, onAction }: EvidencePanelProps) {
  const currency = data.kpis.currency;

  if (!row) {
    return (
      <PanelShell headingRef={headingRef} title="Evidence">
        <p className="rounded-lg border border-dashed border-rule-strong p-4 text-sm text-ink-faint">
          Pick a row in the grid to see why it was flagged. Use ↑ ↓ to move between rows.
        </p>
      </PanelShell>
    );
  }

  const flag = row.flag;
  const line = row.line;
  const isBatch = row.lineId === BATCH_LINE_ID;
  const citedKeys = flag?.rationale?.citedEvidenceKeys ?? [];
  const velocity = line?.payeeId ? data.velocitySeries[line.payeeId] : undefined;
  const meta = flag ? RULE_META[flag.ruleId] : undefined;

  return (
    <PanelShell headingRef={headingRef} title={flag ? (meta?.title ?? flag.ruleId) : row.name}>
      <div className="flex flex-col gap-3">
        {/* what is this line */}
        <div className="flex flex-wrap items-center gap-2">
          {flag ? <SeverityChip severity={flag.severity} /> : null}
          {flag?.blocking ? (
            <span className="rounded-full border border-sev-critical/30 px-2 py-0.5 text-[0.6875rem] font-semibold text-sev-critical">
              Blocks approval
            </span>
          ) : null}
          {line && !line.include ? (
            <span className="rounded-full border border-rule-strong bg-paper-deep px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-soft">
              Excluded from plan
            </span>
          ) : null}
        </div>

        {meta ? <p className="text-sm text-ink-soft">{meta.blurb}</p> : null}

        <div className="rounded-lg border border-rule bg-surface px-3 py-2.5 text-sm">
          <p className="font-semibold text-ink">{isBatch ? "Whole batch" : row.name}</p>
          <p className="num text-xs text-ink-faint">
            {isBatch ? `${data.kpis.includedCount} lines` : `${row.payeeRef}${row.sourceRow ? ` · row ${row.sourceRow}` : ""}`}
          </p>
          <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="num text-lg text-ink">{formatMoney(row.amountMinor, currency)}</span>
            {row.deltaMinor !== null ? (
              <span className="text-xs text-ink-soft">
                {formatSignedMoney(row.deltaMinor, currency)} vs {isBatch ? "last cycle" : "last payout"}
              </span>
            ) : null}
          </div>
          {!isBatch ? <p className="num mt-1 truncate text-xs text-ink-soft">{row.destination}</p> : null}
          {line?.note ? <p className="mt-1 text-xs italic text-ink-faint">“{line.note}”</p> : null}
        </div>

        {/* evidence widgets */}
        {flag?.ruleId === "ENTITY_MATCH" && line && flag.matchedPayee ? (
          <IdentityCompare line={line} matched={flag.matchedPayee} />
        ) : null}
        {flag ? <EvidenceBars items={flag.evidence} citedKeys={citedKeys} /> : null}
        {flag ? <EvidenceList items={flag.evidence} currency={currency} citedKeys={citedKeys} /> : null}
        {flag ? (
          <EsqlPanel ruleId={flag.ruleId} evidence={flag.evidence} esql={data.esql} cycleDate={data.run.cycleDate} />
        ) : null}
        {velocity ? <VelocityChart series={velocity} /> : null}

        {flag?.relatedLineIds.length ? (
          <p className="text-xs text-ink-soft">
            Related lines in this batch:{" "}
            {flag.relatedLineIds.map((id) => {
              const related = data.lines.find((l) => l.lineId === id);
              return (
                <code key={id} className="num mr-1 rounded bg-paper-deep px-1 py-0.5">
                  {related ? `${related.payeeRef} (row ${related.sourceRow})` : id}
                </code>
              );
            })}
          </p>
        ) : null}

        {flag ? <RationaleBlock rationale={flag.rationale} llmMode={data.llmMode} /> : null}

        {/* decision */}
        {flag ? (
          <DecisionBlock row={row} canEdit={canEdit} onAction={onAction} />
        ) : (
          <p className="rounded-lg border border-dashed border-rule-strong p-3 text-sm text-ink-faint">
            This line has no flags. It goes out with the plan as written.
          </p>
        )}
      </div>
    </PanelShell>
  );
}

function PanelShell({
  title,
  headingRef,
  children,
}: {
  title: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label="Evidence"
      className="flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border border-rule-strong bg-paper/80 shadow-[0_1px_0_rgb(15_31_30/0.05),0_12px_30px_-18px_rgb(15_31_30/0.35)] backdrop-blur"
    >
      <div className="border-b border-rule px-4 py-3">
        <p className="eyebrow">Evidence</p>
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-2xl leading-tight font-semibold text-ink outline-none focus-visible:underline"
        >
          {title}
        </h3>
      </div>
      <div className="overflow-y-auto px-4 py-3">{children}</div>
    </aside>
  );
}

function DecisionBlock({
  row,
  canEdit,
  onAction,
}: {
  row: GridRow;
  canEdit: boolean;
  onAction: (row: GridRow, action: "ACCEPTED" | "EXCLUDED") => void;
}) {
  const disposition = row.flag?.disposition;

  if (disposition) {
    const isAccept = disposition.action === "ACCEPTED";
    return (
      <section
        className={`rounded-lg border p-3 text-sm ${isAccept ? "border-ok/30 bg-ok-wash" : "border-rule-strong bg-paper-deep"}`}
        aria-label="Decision"
      >
        <p className="font-semibold text-ink">
          {isAccept ? "Accepted" : "Line excluded"} by {disposition.actorId}
        </p>
        <p className="mt-0.5 text-ink-soft">“{disposition.reason}”</p>
        <p className="mt-1 text-[0.6875rem] text-ink-faint">{formatDateTime(disposition.at)}</p>
      </section>
    );
  }

  if (!canEdit) {
    return (
      <p className="rounded-lg border border-dashed border-rule-strong p-3 text-sm text-ink-faint">
        Decisions are locked while the run is not in review.
      </p>
    );
  }

  const canExclude = row.lineId !== BATCH_LINE_ID;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-rule-strong bg-surface p-3" aria-label="Decision">
      <p className="text-sm font-semibold text-ink">Your call</p>
      <p className="text-xs text-ink-soft">
        Accept keeps the line in the plan. Exclude removes it and re-runs the rules, so the plan hash changes.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="border-ok/50 text-ok hover:bg-ok-wash hover:text-ok" onClick={() => onAction(row, "ACCEPTED")}>
          <Check /> Accept with reason <kbd className="num ml-1 rounded border border-ok/30 px-1 text-[0.625rem]">A</kbd>
        </Button>
        {canExclude ? (
          <Button type="button" variant="outline" size="sm" className="border-sev-critical/50 text-sev-critical hover:bg-sev-critical-wash hover:text-sev-critical" onClick={() => onAction(row, "EXCLUDED")}>
            <X /> Exclude line <kbd className="num ml-1 rounded border border-sev-critical/30 px-1 text-[0.625rem]">X</kbd>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
