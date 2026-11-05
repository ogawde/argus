import type { MatchedPayee, StudioLine } from "@/domain/studio-data";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/components/run/format";

interface CompareRow {
  label: string;
  established: string;
  incoming: string;
  /** true = the two sides agree, false = they differ, null = not comparable */
  isSame: boolean | null;
}

function buildRows(line: StudioLine, matched: MatchedPayee): CompareRow[] {
  const sameName = matched.displayName.trim().toLowerCase() === line.displayName.trim().toLowerCase();
  return [
    { label: "Name", established: matched.displayName, incoming: line.displayName, isSame: sameName },
    { label: "Legal name", established: matched.legalName, incoming: "—", isSame: null },
    { label: "Payee ref", established: matched.id, incoming: `${line.payeeRef} (new)`, isSame: false },
    {
      label: "Destination",
      established: matched.destination,
      incoming: line.destination,
      isSame: matched.destination.toLowerCase() === line.destination.toLowerCase(),
    },
    {
      label: "Last payout",
      established: matched.lastAmountMinor === null ? "never paid" : formatMoney(matched.lastAmountMinor, line.currency),
      incoming: formatMoney(line.amountMinor, line.currency),
      isSame: matched.lastAmountMinor === null ? null : matched.lastAmountMinor === line.amountMinor,
    },
    {
      label: "History",
      established: `${matched.paymentCount} payouts${matched.lastPaidAt ? `, last ${formatDate(matched.lastPaidAt)}` : ""}`,
      incoming: "first time in the master",
      isSame: null,
    },
  ];
}

/** Side-by-side: the established payee vs the new line in this batch. */
export function IdentityCompare({ line, matched }: { line: StudioLine; matched: MatchedPayee }) {
  const rows = buildRows(line, matched);
  return (
    <div className="overflow-hidden rounded-lg border border-rule bg-surface text-sm">
      <div className="grid grid-cols-[5.5rem_1fr_1fr] border-b border-rule bg-paper-deep/70 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-soft">
        <span className="px-3 py-1.5" />
        <span className="px-3 py-1.5">Established</span>
        <span className="px-3 py-1.5 text-teal-deep">In this batch</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[5.5rem_1fr_1fr] border-b border-rule last:border-b-0">
          <span className="px-3 py-2 text-xs text-ink-faint">{row.label}</span>
          <span className="break-words px-3 py-2">{row.established}</span>
          <span
            className={cn(
              "break-words px-3 py-2",
              row.isSame === true && "bg-teal-wash/70 font-medium text-teal-deep",
              row.isSame === false && "bg-sev-warn-wash/50",
            )}
          >
            {row.incoming}
            {row.isSame === true ? <span className="sr-only"> (matches)</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
