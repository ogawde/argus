import type { StudioData } from "@/domain/studio-data";
import { cn } from "@/lib/utils";
import { formatSignedMoney, shortHash } from "@/components/run/format";

/** What changed since the previous plan revision (for example after an Exclude), plus the hash trail. */
export function PlanChanges({ data }: { data: StudioData }) {
  const { planDiff, kpis } = data;

  return (
    <section className="flex flex-col gap-3" aria-label="Changes since previous plan">
      <div>
        <h3 className="eyebrow">Changes since previous plan</h3>
        {planDiff.parentHash ? (
          <p className="mt-1 text-sm text-ink-soft">
            Compared with <code className="num rounded bg-paper-deep px-1">{shortHash(planDiff.parentHash)}</code>:{" "}
            <strong className="num text-ink">
              {planDiff.deltaIncludedCount > 0 ? "+" : planDiff.deltaIncludedCount < 0 ? "−" : ""}
              {Math.abs(planDiff.deltaIncludedCount)} lines
            </strong>
            ,{" "}
            <strong className="num text-ink">{formatSignedMoney(planDiff.deltaIncludedMinor, kpis.currency)}</strong>
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-faint">First revision. Excluding a line creates a new revision and shows the difference here.</p>
        )}
      </div>

      {planDiff.lines.length > 0 ? (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-surface text-sm">
          {planDiff.lines.map((line) => (
            <li key={`${line.payeeRef}-${line.kind}-${line.afterMinor ?? line.beforeMinor}`} className="flex items-center gap-3 px-3 py-1.5">
              <span
                aria-hidden
                className={cn(
                  "num flex size-5 items-center justify-center rounded text-xs font-bold",
                  line.kind === "added" && "bg-teal-wash text-teal-deep",
                  line.kind === "removed" && "bg-sev-critical-wash text-sev-critical",
                  line.kind === "changed" && "bg-sev-warn-wash text-sev-warn",
                )}
              >
                {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : "~"}
              </span>
              <span className="sr-only">{line.kind}</span>
              <span className="min-w-0 flex-1 truncate">
                {line.displayName} <span className="num text-xs text-ink-faint">{line.payeeRef}</span>
              </span>
              <span className="num text-xs text-ink-soft">{formatSignedMoney(line.deltaMinor, kpis.currency)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {data.revisions.length > 1 ? (
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint" aria-label="Plan hash history">
          {[...data.revisions].reverse().map((revision, index, all) => (
            <li key={revision.hash} className="flex items-center gap-1.5">
              <code
                className={cn(
                  "num rounded border px-1.5 py-0.5",
                  revision.hash === data.planHash ? "border-teal bg-teal-wash text-teal-deep" : "border-rule bg-surface",
                )}
              >
                {shortHash(revision.hash)}
              </code>
              {index < all.length - 1 ? <span aria-hidden>→</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
