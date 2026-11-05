"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CellFocusedEvent, CellKeyDownEvent, ColDef, GridApi, GridReadyEvent } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { BATCH_LINE_ID } from "@/domain/studio-data";
import {
  ActionsCell,
  AmountCell,
  DeltaCell,
  DestinationCell,
  GridEmpty,
  MarkerCell,
  PayeeCell,
  RuleCell,
  SeverityCell,
  StatusCell,
  type GridContext,
} from "@/components/run/grid-cells";
import type { GridRow } from "@/components/run/grid-rows";

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid theme built from the shared Argus CSS variables (see globals.css). */
const argusGridTheme = themeQuartz.withParams({
  fontFamily: "var(--font-argus-body), system-ui, sans-serif",
  fontSize: 13,
  accentColor: "var(--argus-teal)",
  backgroundColor: "var(--argus-surface)",
  foregroundColor: "var(--argus-ink)",
  borderColor: "var(--argus-rule)",
  headerBackgroundColor: "var(--argus-paper-deep)",
  headerTextColor: "var(--argus-ink-soft)",
  headerFontWeight: 600,
  headerFontSize: 11,
  rowHoverColor: "color-mix(in srgb, var(--argus-teal-wash) 55%, transparent)",
  selectedRowBackgroundColor: "var(--argus-teal-wash)",
  rowBorder: true,
  wrapperBorderRadius: 10,
  rowHeight: 52,
  headerHeight: 38,
  spacing: 7,
});

const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 38;

interface FlagGridProps {
  rows: GridRow[];
  selectedKey: string | null;
  canEdit: boolean;
  currency: string;
  emptyMessage: string;
  onSelect: (key: string) => void;
  onAction: (row: GridRow, action: "ACCEPTED" | "EXCLUDED") => void;
  onOpenEvidence: () => void;
}

/** The review grid. Virtualized by AG Grid, so 300+ rows stay snappy. */
export function FlagGrid({
  rows,
  selectedKey,
  canEdit,
  currency,
  emptyMessage,
  onSelect,
  onAction,
  onOpenEvidence,
}: FlagGridProps) {
  const apiRef = useRef<GridApi<GridRow> | null>(null);

  // no open flags means nothing to act on, so the Actions column steps aside
  const hasOpenFlags = canEdit && rows.some((row) => row.flag && row.status === "open");

  const maxAbsDelta = useMemo(
    () => rows.reduce((max, row) => Math.max(max, Math.abs(row.deltaMinor ?? 0)), 0),
    [rows],
  );

  // `context` is how cell renderers reach our callbacks
  const context = useMemo<GridContext>(
    () => ({ canEdit, currency, maxAbsDelta, onAction }),
    [canEdit, currency, maxAbsDelta, onAction],
  );

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        colId: "marker",
        headerName: "±",
        headerTooltip: "+ new payee · − excluded · ~ amount differs from last payout",
        width: 44,
        sortable: false,
        cellRenderer: MarkerCell,
        valueGetter: (p) => p.data?.marker,
      },
      {
        colId: "severity",
        headerName: "Severity",
        field: "severityRank",
        width: 104,
        sort: "desc",
        sortIndex: 0,
        cellRenderer: SeverityCell,
        filter: false,
      },
      {
        colId: "rule",
        headerName: "Rule",
        field: "ruleTitle",
        flex: 1.2,
        minWidth: 150,
        cellRenderer: RuleCell,
        filter: "agTextColumnFilter",
      },
      {
        colId: "payee",
        headerName: "Payee",
        field: "name",
        flex: 1.3,
        minWidth: 130,
        cellRenderer: PayeeCell,
        filter: "agTextColumnFilter",
      },
      {
        colId: "destination",
        headerName: "Destination",
        field: "destination",
        flex: 1.3,
        minWidth: 190,
        hide: true, // shown in the evidence panel; hidden so the key columns fit
        cellRenderer: DestinationCell,
        filter: "agTextColumnFilter",
      },
      {
        colId: "amount",
        headerName: "Amount",
        field: "amountMinor",
        width: 100,
        type: "rightAligned",
        cellRenderer: AmountCell,
        filter: "agNumberColumnFilter",
      },
      {
        colId: "delta",
        headerName: "vs last payout",
        field: "deltaMinor",
        width: 150,
        cellRenderer: DeltaCell,
        filter: "agNumberColumnFilter",
      },
      {
        colId: "status",
        headerName: "Status",
        field: "status",
        width: 100,
        cellRenderer: StatusCell,
      },
      {
        colId: "actions",
        headerName: "Actions",
        width: 180,
        hide: !hasOpenFlags,
        pinned: "right",
        sortable: false,
        filter: false,
        suppressHeaderMenuButton: true,
        cellRenderer: ActionsCell,
      },
    ],
    [hasOpenFlags],
  );

  const defaultColDef = useMemo<ColDef<GridRow>>(
    () => ({ sortable: true, resizable: true, suppressMovable: true }),
    [],
  );

  const onGridReady = useCallback((event: GridReadyEvent<GridRow>) => {
    apiRef.current = event.api;
  }, []);

  // keep the grid's selected row in step with the evidence panel
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.forEachNode((node) => node.setSelected(node.data?.key === selectedKey));
  }, [selectedKey, rows]);

  // arrow-key navigation moves the selection too, so the evidence panel follows
  const onCellFocused = useCallback(
    (event: CellFocusedEvent<GridRow>) => {
      if (event.rowIndex === null || event.rowIndex === undefined) return;
      const node = event.api.getDisplayedRowAtIndex(event.rowIndex);
      if (node?.data && node.data.key !== selectedKey) onSelect(node.data.key);
    },
    [onSelect, selectedKey],
  );

  // keyboard shortcuts while a cell is focused: A accept · X exclude · Enter open evidence
  const onCellKeyDown = useCallback(
    (event: CellKeyDownEvent<GridRow>) => {
      const keyboardEvent = event.event as KeyboardEvent | null;
      const row = event.data;
      if (!keyboardEvent || !row) return;
      const target = keyboardEvent.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey) return;

      const key = keyboardEvent.key.toLowerCase();
      if (key === "enter") {
        // Enter on the actions buttons should press the button, not jump away
        if (target?.tagName === "BUTTON") return;
        keyboardEvent.preventDefault();
        onOpenEvidence();
        return;
      }
      if (!canEdit || row.status !== "open" || !row.flag) return;
      if (key === "a") {
        keyboardEvent.preventDefault();
        onAction(row, "ACCEPTED");
      } else if (key === "x" && row.lineId !== BATCH_LINE_ID) {
        keyboardEvent.preventDefault();
        onAction(row, "EXCLUDED");
      }
    },
    [canEdit, onAction, onOpenEvidence],
  );

  // grow with the rows, but stay between a sensible min and max
  const height = Math.min(Math.max(rows.length, 7), 13) * ROW_HEIGHT + HEADER_HEIGHT + 20;

  return (
    <div style={{ height }} className="w-full" role="region" aria-label="Flagged lines grid">
      <AgGridReact<GridRow>
        theme={argusGridTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={(params) => params.data.key}
        context={context}
        rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
        onGridReady={onGridReady}
        onCellFocused={onCellFocused}
        onCellKeyDown={onCellKeyDown}
        noRowsOverlayComponent={GridEmpty}
        noRowsOverlayComponentParams={{ message: emptyMessage }}
        tooltipShowDelay={400}
        animateRows={false}
        suppressCellFocus={false}
        rowBuffer={12}
      />
    </div>
  );
}
