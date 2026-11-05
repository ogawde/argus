"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioData } from "@/domain/studio-data";
import { ruleTitle } from "@/components/run/rule-meta";
import { tokenColor } from "@/components/run/tokens";

/**
 * AG Studio island: the same studio-data document, loaded into Studio's data engine.
 * It opens as a ready-made report (value tiles, flags by rule, flags by severity, grid)
 * and is in edit mode so a reviewer can drag in their own widgets and cross-filter.
 *
 * Studio cannot host our Server Action buttons, so decisions stay in the AG Grid review tab.
 * Default export so it can be loaded with next/dynamic.
 */
export default function StudioExplorer({ data }: { data: StudioData }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Flat rows Studio understands. Money is in major units so charts read naturally.
  const sources = useMemo(() => buildStudioSources(data), [data]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let destroy: (() => void) | null = null;
    let isCancelled = false;

    import("ag-studio")
      .then(({ createStudio, studioTheme }) => {
        if (isCancelled) return;

        const theme = studioTheme.withParams({
          fontFamily: "Instrument Sans, system-ui, sans-serif",
          accentColor: tokenColor("--argus-teal", "#0e7c73"),
          backgroundColor: tokenColor("--argus-surface", "#fafbf8"),
          foregroundColor: tokenColor("--argus-ink", "#0f1f1e"),
          textColor: tokenColor("--argus-ink", "#0f1f1e"),
          borderColor: tokenColor("--argus-rule", "#cdd7d0"),
        });

        const api = createStudio(element, {
          mode: "edit",
          theme,
          data: { sources },
          initialState: buildStarterReport(),
        });
        destroy = () => api.destroy();
      })
      .catch((err: unknown) => {
        console.error("AG Studio failed to load", err);
        if (!isCancelled) setError(err instanceof Error ? err.message : "AG Studio failed to load");
      });

    return () => {
      isCancelled = true;
      destroy?.();
    };
  }, [sources]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-soft">
        Drag fields onto the canvas to build your own views of this batch. Clicking a bar cross-filters the rest.
        Accept / Exclude live in the Review tab.
      </p>
      {error ? (
        <p role="alert" className="rounded-lg border border-sev-critical/30 bg-sev-critical-wash px-3 py-2 text-sm text-sev-critical">
          AG Studio could not start: {error}
        </p>
      ) : null}
      <div ref={containerRef} className="h-[760px] w-full overflow-hidden rounded-xl border border-rule-strong bg-surface" />
    </div>
  );
}

function buildStudioSources(data: StudioData) {
  const lineById = new Map(data.lines.map((l) => [l.lineId, l]));

  const flags = data.flags.map((flag) => {
    const line = lineById.get(flag.lineId);
    return {
      flag_id: flag.id,
      rule: ruleTitle(flag.ruleId),
      severity: flag.severity,
      blocking: flag.blocking ? "Blocking" : "Advisory",
      status: flag.disposition ? (flag.disposition.action === "ACCEPTED" ? "Accepted" : "Excluded") : "Open",
      payee: line?.displayName ?? "Whole batch",
      payee_ref: line?.payeeRef ?? "—",
      amount: (line?.amountMinor ?? 0) / 100,
      delta_vs_last: line?.deltaMinor === null || line?.deltaMinor === undefined ? null : line.deltaMinor / 100,
      has_rationale: flag.rationale ? "Yes" : "No",
    };
  });

  const lines = data.lines.map((line) => ({
    line_id: line.lineId,
    row: line.sourceRow,
    payee: line.displayName,
    payee_ref: line.payeeRef,
    amount: line.amountMinor / 100,
    last_payout: line.lastAmountMinor === null ? null : line.lastAmountMinor / 100,
    included: line.include ? "Included" : "Excluded",
    new_payee: line.isNewPayee ? "New" : "Known",
  }));

  return [
    { id: "flags", name: "Flags", data: flags },
    { id: "lines", name: "Lines", data: lines },
  ];
}

/** A small ready-made report. Field ids match the flat rows above. */
function buildStarterReport() {
  return {
    selectedPageId: "overview",
    pages: [
      {
        id: "overview",
        widgets: {
          flagsByRule: {
            type: "column-chart-grouped",
            dataMapping: {
              categoryKey: [{ id: "flags.rule" }],
              valueKey: [{ id: "flags.flag_id", aggregation: "count" }],
            },
            format: { title: { enabled: true, text: "Flags by rule" } },
          },
          flagsBySeverity: {
            type: "donut-chart",
            dataMapping: {
              categoryKey: [{ id: "flags.severity" }],
              valueKey: [{ id: "flags.flag_id", aggregation: "count" }],
            },
            format: { title: { enabled: true, text: "Flags by severity" } },
          },
          flagGrid: {
            type: "grid",
            dataMapping: {
              cols: [
                { id: "flags.severity" },
                { id: "flags.rule" },
                { id: "flags.payee" },
                { id: "flags.amount" },
                { id: "flags.status" },
              ],
            },
            format: { title: { enabled: true, text: "Flags" } },
          },
        },
        widgetLayout: {
          flagsByRule: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 14 },
          flagsBySeverity: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 14 },
          flagGrid: { xTrack: 0, yTrack: 14, xSpan: 24, ySpan: 16 },
        },
      },
    ],
  } as never;
}
