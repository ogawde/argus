"use client";

import { Search } from "lucide-react";
import type { Severity, StudioData } from "@/domain/studio-data";
import { cn } from "@/lib/utils";
import type { GridFilters, GridView } from "@/components/run/grid-rows";
import { RULE_META, SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_STYLE } from "@/components/run/rule-meta";

interface GridToolbarProps {
  data: StudioData;
  filters: GridFilters;
  counts: { flags: number; open: number; all: number };
  onChange: (next: GridFilters) => void;
}

const VIEWS: Array<{ id: GridView; label: string }> = [
  { id: "flags", label: "Flags" },
  { id: "open", label: "Open" },
  { id: "all", label: "All lines" },
];

/** View tabs, severity chips, rule picker and search for the grid. */
export function GridToolbar({ data, filters, counts, onChange }: GridToolbarProps) {
  const rules = [...new Set(data.flags.map((f) => f.ruleId))].sort();

  function toggleSeverity(severity: Severity) {
    const next = filters.severities.includes(severity)
      ? filters.severities.filter((s) => s !== severity)
      : [...filters.severities, severity];
    onChange({ ...filters, severities: next });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="tablist" aria-label="Grid view" className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5">
        {VIEWS.map((view) => {
          const isActive = filters.view === view.id;
          return (
            <button
              key={view.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => onChange({ ...filters, view: view.id })}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-teal",
                isActive ? "bg-ink text-surface" : "text-ink-soft hover:bg-paper-deep",
              )}
            >
              {view.label} <span className="num ml-0.5 opacity-70">{counts[view.id]}</span>
            </button>
          );
        })}
      </div>

      <div role="group" aria-label="Filter by severity" className="flex items-center gap-1.5">
        {SEVERITY_ORDER.map((severity) => {
          const isOn = filters.severities.includes(severity);
          return (
            <button
              key={severity}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggleSeverity(severity)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-teal",
                isOn ? SEVERITY_STYLE[severity].chip : "border-rule-strong bg-surface text-ink-soft hover:bg-paper-deep",
              )}
            >
              <span className={cn("size-2 rounded-full", SEVERITY_STYLE[severity].dot)} aria-hidden />
              {SEVERITY_LABEL[severity]}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-1.5 text-xs text-ink-soft">
        <span className="sr-only">Filter by rule</span>
        <select
          value={filters.ruleId}
          onChange={(event) => onChange({ ...filters, ruleId: event.target.value })}
          className="h-8 rounded-md border border-rule-strong bg-surface px-2 text-xs text-ink focus-visible:outline-2 focus-visible:outline-teal"
        >
          <option value="">All rules</option>
          {rules.map((ruleId) => (
            <option key={ruleId} value={ruleId}>
              {RULE_META[ruleId]?.title ?? ruleId}
            </option>
          ))}
        </select>
      </label>

      <label className="relative ml-auto flex items-center">
        <span className="sr-only">Search payee, destination or rule</span>
        <Search className="pointer-events-none absolute left-2 size-3.5 text-ink-faint" aria-hidden />
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          placeholder="Search payee…"
          className="h-8 w-44 rounded-md border border-rule-strong bg-surface pl-7 pr-2 text-xs text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-teal"
        />
      </label>
    </div>
  );
}
