"use client";

import { useMemo } from "react";
import { AllCommunityModule, ModuleRegistry } from "ag-charts-community";
import type { AgCartesianChartOptions } from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import type { VelocitySeries } from "@/domain/studio-data";
import { tokenColor } from "@/components/run/tokens";

ModuleRegistry.registerModules([AllCommunityModule]);

/** Weekly payouts for one payee. Weeks inside the burst window are colored differently. */
export function VelocityChart({ series }: { series: VelocitySeries }) {
  const options = useMemo<AgCartesianChartOptions>(() => {
    const teal = tokenColor("--argus-teal", "#0e7c73");
    const warn = tokenColor("--argus-warn", "#a96a0c");
    const ink = tokenColor("--argus-ink-soft", "#3a4d4b");
    const rule = tokenColor("--argus-rule", "#cdd7d0");
    const font = "Instrument Sans, system-ui, sans-serif";

    return {
      height: 190,
      background: { fill: "transparent" },
      padding: { top: 8, right: 8, bottom: 0, left: 0 },
      data: series.points.map((point) => ({
        week: point.weekStart.slice(5), // MM-DD
        earlier: point.inBurst ? 0 : point.count,
        burst: point.inBurst ? point.count : 0,
      })),
      series: [
        { type: "bar", xKey: "week", yKey: "earlier", yName: "Earlier weeks", stacked: true, fill: teal, cornerRadius: 2 },
        { type: "bar", xKey: "week", yKey: "burst", yName: "Burst window", stacked: true, fill: warn, cornerRadius: 2 },
      ],
      axes: {
        x: {
          type: "category",
          position: "bottom",
          label: { color: ink, fontFamily: font, fontSize: 10, avoidCollisions: true },
          line: { stroke: rule },
        },
        y: {
          type: "number",
          position: "left",
          interval: { minSpacing: 28 },
          label: { color: ink, fontFamily: font, fontSize: 10 },
          gridLine: { style: [{ stroke: rule, lineDash: [2, 4] }] },
        },
      },
      legend: { position: "bottom", item: { label: { color: ink, fontFamily: font, fontSize: 11 } } },
    };
  }, [series]);

  const total = series.points.reduce((sum, p) => sum + p.count, 0);
  const burstTotal = series.points.reduce((sum, p) => sum + (p.inBurst ? p.count : 0), 0);

  return (
    <section className="rounded-lg border border-rule bg-surface p-3" aria-label={`Payout velocity for ${series.name}`}>
      <header className="mb-1 flex items-baseline justify-between gap-2">
        <h4 className="eyebrow">Payout cadence · {series.name}</h4>
        <span className="text-xs text-ink-soft">
          <strong className="num text-ink">{burstTotal}</strong> of {total} payouts in the burst window
        </span>
      </header>
      <AgCharts options={options} />
    </section>
  );
}
