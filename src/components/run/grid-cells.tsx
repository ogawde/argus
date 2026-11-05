"use client";

import type { CustomCellRendererProps, CustomNoRowsOverlayProps } from "ag-grid-react";
import { Check, X } from "lucide-react";
import { BATCH_LINE_ID, type LineMarker } from "@/domain/studio-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney, formatSignedMoney } from "@/components/run/format";
import type { GridRow, RowStatus } from "@/components/run/grid-rows";
import { SeverityChip } from "@/components/run/severity-chip";

/** What the grid hands to every cell through `context`. */
export interface GridContext {
  canEdit: boolean;
  currency: string;
  maxAbsDelta: number;
  onAction: (row: GridRow, action: "ACCEPTED" | "EXCLUDED") => void;
}

type CellProps = CustomCellRendererProps<GridRow, unknown, GridContext>;

const MARKER_INFO: Record<LineMarker, { label: string; glyph: string; className: string }> = {
  added: { label: "New payee", glyph: "+", className: "border-teal/40 bg-teal-wash text-teal-deep" },
  removed: { label: "Excluded from this plan", glyph: "−", className: "border-rule-strong bg-paper-deep text-ink-soft" },
  changed: { label: "Amount differs from last payout", glyph: "~", className: "border-sev-warn/40 bg-sev-warn-wash text-sev-warn" },
  same: { label: "Same as last payout", glyph: "·", className: "border-transparent text-ink-faint/60" },
};

/** + / − / ~ diff marker */
export function MarkerCell({ data }: CellProps) {
  if (!data) return null;
  const info = MARKER_INFO[data.marker];
  return (
    <span className="flex h-full items-center">
      <span
        title={info.label}
        role="img"
        aria-label={info.label}
        className={cn("num inline-flex size-6 items-center justify-center rounded-md border text-sm font-bold", info.className)}
      >
        {info.glyph}
      </span>
    </span>
  );
}

export function SeverityCell({ data }: CellProps) {
  if (!data?.severity) return <span className="text-ink-faint">—</span>;
  return (
    <span className="flex h-full items-center">
      <SeverityChip severity={data.severity} />
    </span>
  );
}

export function RuleCell({ data }: CellProps) {
  if (!data?.ruleId) return <span className="text-ink-faint">No flags</span>;
  return (
    <span className="flex h-full w-full min-w-0 flex-col justify-center leading-tight">
      <span className="font-medium text-ink">{data.ruleTitle}</span>
      {data.blocking ? (
        <span className="text-[0.6875rem] font-medium text-sev-critical">Blocks approval</span>
      ) : (
        <span className="text-[0.6875rem] text-ink-faint">Advisory</span>
      )}
    </span>
  );
}

export function PayeeCell({ data }: CellProps) {
  if (!data) return null;
  return (
    <span className="flex h-full w-full min-w-0 flex-col justify-center leading-tight">
      <span className={cn("truncate font-medium text-ink", data.status === "excluded" && "line-through opacity-60")}>
        {data.name}
      </span>
      <span className="num truncate text-[0.6875rem] text-ink-faint">
        {data.payeeRef}
        {data.sourceRow ? ` · row ${data.sourceRow}` : ""}
      </span>
    </span>
  );
}

export function DestinationCell({ data }: CellProps) {
  if (!data) return null;
  return <span className="num w-full min-w-0 truncate text-xs text-ink-soft">{data.destination}</span>;
}

export function AmountCell({ data, context }: CellProps) {
  if (!data) return null;
  return (
    <span className={cn("num w-full text-right text-sm text-ink", data.status === "excluded" && "line-through opacity-60")}>
      {formatMoney(data.amountMinor, context.currency)}
    </span>
  );
}

/** Bar that grows left (less than last payout) or right (more) from a center line. */
export function DeltaCell({ data, context }: CellProps) {
  if (!data) return null;
  if (data.deltaMinor === null) {
    return <span className="text-xs text-ink-faint">no history</span>;
  }
  const share = context.maxAbsDelta > 0 ? Math.min(1, Math.abs(data.deltaMinor) / context.maxAbsDelta) : 0;
  const widthPercent = Math.max(share * 50, data.deltaMinor === 0 ? 0 : 3);
  const isUp = data.deltaMinor > 0;
  return (
    <span className="flex h-full items-center gap-2">
      <span className="relative h-2.5 w-20 shrink-0 rounded-full bg-paper-deep" aria-hidden>
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-rule-strong" />
        <span
          className={cn("absolute inset-y-0 rounded-full", isUp ? "bg-sev-warn" : "bg-teal")}
          style={{ width: `${widthPercent}%`, left: isUp ? "50%" : `${50 - widthPercent}%` }}
        />
      </span>
      <span className="num text-xs text-ink-soft">{formatSignedMoney(data.deltaMinor, context.currency)}</span>
    </span>
  );
}

const STATUS_STYLE: Record<RowStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "border-ink/25 bg-surface text-ink" },
  accepted: { label: "Accepted", className: "border-ok/30 bg-ok-wash text-ok" },
  excluded: { label: "Excluded", className: "border-rule-strong bg-paper-deep text-ink-soft" },
  clean: { label: "Clean", className: "border-transparent text-ink-faint" },
};

export function StatusCell({ data }: CellProps) {
  if (!data) return null;
  const style = STATUS_STYLE[data.status];
  return (
    <span className="flex h-full items-center">
      <span className={cn("rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold", style.className)}>
        {style.label}
      </span>
    </span>
  );
}

/** Row actions: Accept (with reason) and Exclude (with reason). Both open the reason dialog. */
export function ActionsCell({ data, context }: CellProps) {
  if (!data?.flag || data.status !== "open" || !context.canEdit) return null;
  const canExclude = data.lineId !== BATCH_LINE_ID;
  return (
    <span className="flex h-full w-full items-center justify-end gap-1.5">
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="border-ok/40 text-ok hover:bg-ok-wash hover:text-ok"
        onClick={() => context.onAction(data, "ACCEPTED")}
        aria-label={`Accept flag: ${data.ruleTitle} on ${data.name}`}
      >
        <Check /> Accept
      </Button>
      {canExclude ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="border-sev-critical/40 text-sev-critical hover:bg-sev-critical-wash hover:text-sev-critical"
          onClick={() => context.onAction(data, "EXCLUDED")}
          aria-label={`Exclude line: ${data.name}`}
        >
          <X /> Exclude
        </Button>
      ) : null}
    </span>
  );
}

/** Empty state for the grid. */
export function GridEmpty(props: CustomNoRowsOverlayProps & { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 text-center">
      <p className="font-display text-lg text-ink">Nothing to show here</p>
      <p className="text-sm text-ink-faint">{props.message ?? "Try another view or clear the filters."}</p>
    </div>
  );
}
