"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CheckCheck, Radio, X } from "lucide-react";
import type { StudioData } from "@/domain/studio-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApprovalPanel } from "@/components/run/approval-panel";
import { EvidencePanel } from "@/components/run/evidence-panel";
import { FlagGrid } from "@/components/run/flag-grid";
import { GridToolbar } from "@/components/run/grid-toolbar";
import {
  buildGridRows,
  filterGridRows,
  sortGridRows,
  type GridFilters,
  type GridRow,
} from "@/components/run/grid-rows";
import { KpiStrip } from "@/components/run/kpi-strip";
import { PlanChanges } from "@/components/run/plan-changes";
import { PlanningSteps } from "@/components/run/planning-steps";
import { ReasonDialog, type ReasonRequest } from "@/components/run/reason-dialog";
import { ReconciliationPanel } from "@/components/run/reconciliation-panel";
import { RunHeader } from "@/components/run/run-header";
import { useRunData } from "@/components/run/use-run-data";
import { bulkAcceptWarnings, dispositionFlag } from "@/server/actions/disposition";
import { rejectRun } from "@/server/actions/approval";
import type { ActionResult } from "@/server/actions/result";
import { startPlanning } from "@/server/actions/start-planning";

// AG Studio is big, so it only loads when someone opens the Explore tab.
const StudioExplorer = dynamic(() => import("@/components/run/studio-explorer"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-ink-faint">Loading AG Studio…</p>,
});

type Tab = "review" | "explore";
type Notice = { tone: "ok" | "error"; text: string } | null;

interface PendingDecision {
  request: ReasonRequest;
  submit: (reason: string) => Promise<ActionResult<unknown>>;
  successText: (result: unknown) => string;
}

const DEFAULT_FILTERS: GridFilters = { view: "flags", severities: [], ruleId: "", search: "" };

/** Everything on /runs/[id] below the app bar. Client-only because AG Grid / Charts / Studio need the browser. */
export default function RunDashboard({
  initialData,
  flashError,
}: {
  initialData: StudioData;
  flashError?: string;
}) {
  const { data, refresh, isRefreshing, liveState } = useRunData(initialData);
  const runId = data.run.id;
  const status = data.run.status;

  const [tab, setTab] = useState<Tab>("review");
  const [filters, setFilters] = useState<GridFilters>(DEFAULT_FILTERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isDialogBusy, setIsDialogBusy] = useState(false);
  const [isStartingPlan, setIsStartingPlan] = useState(false);
  const [notice, setNotice] = useState<Notice>(flashError ? { tone: "error", text: flashError } : null);
  const evidenceHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const allRows = useMemo(() => buildGridRows(data), [data]);
  const visibleRows = useMemo(() => sortGridRows(filterGridRows(allRows, filters)), [allRows, filters]);
  const counts = useMemo(
    () => ({
      flags: allRows.filter((r) => r.flag).length,
      open: allRows.filter((r) => r.status === "open").length,
      all: allRows.length,
    }),
    [allRows],
  );

  // the evidence panel follows the selection; fall back to the first visible row
  const selectedRow: GridRow | null =
    allRows.find((r) => r.key === selectedKey) ?? visibleRows[0] ?? null;

  const canEdit = data.permissions.canEditFlags;
  const hasPlan = data.planHash !== null && data.lines.length > 0;

  // ---- decisions (accept / exclude / bulk accept / reject) all share one dialog ----

  const askForDecision = useCallback(
    (row: GridRow, action: "ACCEPTED" | "EXCLUDED") => {
      if (!row.flag) return;
      const flag = row.flag;
      setSelectedKey(row.key);
      setDialogError(null);
      setPending({
        request:
          action === "ACCEPTED"
            ? {
                title: "Accept this flag",
                description: `${row.ruleTitle} on ${row.name} stays in the plan. Say why it is fine to pay.`,
                confirmLabel: "Accept flag",
                busyLabel: "Saving…",
                tone: "accept",
                presets: ["Verified with the payee", "Known and expected", "Within the normal range"],
              }
            : {
                title: `Exclude ${row.name}`,
                description: "The line leaves the plan and the rules run again, so the plan hash changes.",
                confirmLabel: "Exclude line",
                busyLabel: "Excluding and re-running rules…",
                tone: "exclude",
                presets: ["Duplicate — not paying twice", "Could not verify the payee", "Amount looks wrong"],
              },
        submit: (reason) =>
          dispositionFlag({ runId, lineId: flag.lineId, ruleId: flag.ruleId, action, reason }),
        successText: (result) =>
          action === "EXCLUDED"
            ? `${row.name} excluded. The plan has a new hash${(result as { status?: string }).status ? ` and the run is ${(result as { status: string }).status}` : ""}.`
            : `Flag accepted for ${row.name}.`,
      });
    },
    [runId],
  );

  function askForBulkAccept() {
    const count = data.kpis.flagged.openWarnings;
    setDialogError(null);
    setPending({
      request: {
        title: `Accept ${count} warning${count === 1 ? "" : "s"}`,
        description: "Accepts every open non-blocking flag at once. Blocking flags are not touched.",
        confirmLabel: `Accept ${count}`,
        busyLabel: "Saving…",
        tone: "accept",
        presets: ["Reviewed, fine to pay", "Known payees, normal amounts"],
        defaultReason: "Reviewed, fine to pay",
      },
      submit: (reason) => bulkAcceptWarnings(runId, reason),
      successText: (result) => `${(result as { accepted?: number }).accepted ?? count} warnings accepted.`,
    });
  }

  function askForReject() {
    setDialogError(null);
    setPending({
      request: {
        title: "Reject this run",
        description: "Rejecting is final. Nothing will be paid from this file.",
        confirmLabel: "Reject run",
        busyLabel: "Rejecting…",
        tone: "exclude",
        presets: ["Wrong file", "Needs corrections before paying", "Duplicate of another run"],
      },
      submit: (reason) => rejectRun(runId, reason),
      successText: () => "Run rejected.",
    });
  }

  async function submitDecision(reason: string) {
    if (!pending) return;
    setIsDialogBusy(true);
    setDialogError(null);
    try {
      const result = await pending.submit(reason);
      if (!result.ok) {
        setDialogError(result.message);
        return;
      }
      setNotice({ tone: "ok", text: pending.successText(result.data) });
      setPending(null);
      await refresh();
    } finally {
      setIsDialogBusy(false);
    }
  }

  async function beginPlanning() {
    setIsStartingPlan(true);
    setNotice(null);
    try {
      const result = await startPlanning(runId);
      if (!result.ok) setNotice({ tone: "error", text: result.message });
      await refresh();
    } finally {
      setIsStartingPlan(false);
    }
  }

  const isPlanning = status === "PLANNING" || isStartingPlan;

  return (
    <div className="pb-20">
      <RunHeader data={data} />
      <div className="mx-auto max-w-[1500px]">
        <KpiStrip data={data} />
      </div>

      <div className="mx-auto flex max-w-[1500px] flex-col gap-10 px-5 py-8 sm:px-8">
        {notice ? (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm",
              notice.tone === "error"
                ? "border-sev-critical/30 bg-sev-critical-wash text-sev-critical"
                : "border-ok/30 bg-ok-wash text-ok",
            )}
          >
            <p>{notice.text}</p>
            <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)} className="shrink-0 rounded p-0.5 hover:bg-black/5">
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        {isPlanning ? <PlanningSteps /> : null}

        {status === "DRAFT" && !isPlanning ? (
          <section className="flex flex-col items-start gap-3 rounded-xl border border-rule-strong bg-surface p-6">
            <p className="eyebrow">Step 1</p>
            <h2 className="font-display text-3xl font-semibold text-ink">Plan this batch before anything is paid</h2>
            <p className="max-w-xl text-sm text-ink-soft">
              Argus reads the file, checks every line against payee history and Elasticsearch, and proposes a plan with a hash.
              Nothing is sent to PayPal at this stage.
            </p>
            {data.permissions.canStartPlanning ? (
              <Button type="button" size="lg" onClick={beginPlanning}>
                Start planning
              </Button>
            ) : (
              <p className="rounded-md border border-rule-strong bg-paper-deep/60 px-3 py-2 text-sm text-ink-soft">
                Only a preparer can start planning. Switch to Maya (preparer) in the top bar.
              </p>
            )}
          </section>
        ) : null}

        {hasPlan && !isPlanning ? (
          <section className="flex flex-col gap-4" aria-label="Review">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow">Review queue</p>
                <h2 className="font-display text-3xl font-semibold text-ink">
                  {tab === "review" ? "Decide every flag" : "Explore the batch"}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="mr-1 flex items-center gap-1.5 text-xs text-ink-faint"
                  title={liveState === "live" ? "Live updates connected" : "Live updates reconnecting"}
                >
                  <Radio className={cn("size-3.5", liveState === "live" ? "text-ok" : "text-ink-faint")} aria-hidden />
                  {isRefreshing ? "Updating…" : liveState === "live" ? "Live" : "Reconnecting…"}
                </span>
                <div role="tablist" aria-label="Dashboard section" className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5">
                  {(
                    [
                      ["review", "Review"],
                      ["explore", "Explore with AG Studio"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      type="button"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={cn(
                        "rounded-md px-3 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-teal",
                        tab === id ? "bg-teal text-primary-foreground" : "text-ink-soft hover:bg-paper-deep",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab === "review" && canEdit && data.kpis.flagged.openWarnings > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={askForBulkAccept}>
                    <CheckCheck /> Accept {data.kpis.flagged.openWarnings} warnings
                  </Button>
                ) : null}
              </div>
            </div>

            {tab === "review" ? (
              <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26.5rem]">
                <div className="flex min-w-0 flex-col gap-3">
                  <GridToolbar data={data} filters={filters} counts={counts} onChange={setFilters} />
                  <FlagGrid
                    rows={visibleRows}
                    selectedKey={selectedRow?.key ?? null}
                    canEdit={canEdit}
                    currency={data.kpis.currency}
                    emptyMessage={
                      filters.view === "flags" && counts.flags === 0
                        ? "No flags on this plan. Every line passed the checks."
                        : "No rows match these filters."
                    }
                    onSelect={setSelectedKey}
                    onAction={askForDecision}
                    onOpenEvidence={() => evidenceHeadingRef.current?.focus()}
                  />
                  <p className="text-xs text-ink-faint">
                    Keyboard: <kbd className="num rounded border border-rule-strong px-1">↑</kbd>{" "}
                    <kbd className="num rounded border border-rule-strong px-1">↓</kbd> move ·{" "}
                    <kbd className="num rounded border border-rule-strong px-1">Enter</kbd> evidence ·{" "}
                    <kbd className="num rounded border border-rule-strong px-1">A</kbd> accept ·{" "}
                    <kbd className="num rounded border border-rule-strong px-1">X</kbd> exclude
                  </p>
                </div>
                <div className="xl:sticky xl:top-[5.5rem]">
                  <EvidencePanel
                    data={data}
                    row={selectedRow}
                    canEdit={canEdit}
                    headingRef={evidenceHeadingRef}
                    onAction={askForDecision}
                  />
                </div>
              </div>
            ) : (
              <StudioExplorer data={data} />
            )}
          </section>
        ) : null}

        <div className="grid gap-10 border-t border-rule pt-8 lg:grid-cols-[1.1fr_1fr_0.8fr]">
          <ApprovalPanel data={data} onChanged={refresh} onReject={askForReject} />
          <PlanChanges data={data} />
          <ReconciliationPanel data={data} />
        </div>
      </div>

      <ReasonDialog
        request={pending?.request ?? null}
        isBusy={isDialogBusy}
        error={dialogError}
        onCancel={() => setPending(null)}
        onSubmit={submitDecision}
      />
    </div>
  );
}
