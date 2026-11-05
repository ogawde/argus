import Link from "next/link";
import { ArrowLeft, ScrollText, ShieldAlert } from "lucide-react";
import type { StudioData } from "@/domain/studio-data";
import { CopyHashButton } from "@/components/run/copy-hash-button";
import { formatDate, shortHash } from "@/components/run/format";
import { RunStepper } from "@/components/run/run-stepper";

const STATUS_COPY: Record<string, string> = {
  DRAFT: "Uploaded, waiting to be planned",
  PLANNING: "Analysing the file…",
  FLAGGED: "Blocking flags need a decision",
  READY: "Ready for a second pair of eyes",
  APPROVED: "Approved — ready to apply",
  APPLYING: "Applying to PayPal…",
  RECONCILED: "Reconciled with PayPal",
  REJECTED: "Rejected — nothing will be paid",
  FAILED: "Something went wrong",
};

/** Hero band: file name, plan hash, stepper. No cards, just type and rules on the paper. */
export function RunHeader({ data }: { data: StudioData }) {
  const { run, planHash } = data;
  const revisionCount = data.revisions.length;

  return (
    <section className="ledger-lines relative border-b border-rule">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-5 pt-8 pb-7 sm:px-8">
        <nav aria-label="Breadcrumb" className="flex items-center justify-between text-sm">
          <Link href="/" className="flex items-center gap-1.5 text-ink-soft hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> All runs
          </Link>
          <Link href={`/runs/${run.id}/audit`} className="flex items-center gap-1.5 text-ink-soft hover:text-ink">
            <ScrollText className="size-4" aria-hidden /> Audit trail
          </Link>
        </nav>

        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="min-w-0">
            <p className="eyebrow">
              Payout run · cycle {formatDate(run.cycleDate)} · prepared by {run.preparedById}
            </p>
            <h1 className="mt-1 break-words font-display text-4xl leading-[1.05] font-semibold tracking-tight text-ink sm:text-5xl">
              {run.filename}
            </h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
              <span className="num rounded bg-paper-deep px-1.5 py-0.5 text-xs">{run.id.slice(0, 12)}</span>
              {STATUS_COPY[run.status]}
            </p>
          </div>

          <div className="flex flex-col items-start gap-1 sm:items-end">
            <p className="eyebrow">Plan hash {revisionCount > 1 ? `· revision ${revisionCount}` : ""}</p>
            <div className="flex items-center gap-1">
              <code
                className="num rounded-md border border-rule-strong bg-surface px-2.5 py-1 text-sm text-ink"
                title={planHash ?? "No plan yet"}
              >
                {planHash ? shortHash(planHash) : "not planned yet"}
              </code>
              {planHash ? <CopyHashButton hash={planHash} /> : null}
            </div>
            <p className="max-w-xs text-xs text-ink-faint sm:text-right">
              Approval is tied to this exact hash. Change the plan and the hash changes.
            </p>
          </div>
        </div>

        <RunStepper steps={data.stepper} />

        {run.status === "FAILED" ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-sev-critical/30 bg-sev-critical-wash px-3 py-2 text-sm text-sev-critical">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Planning failed: {run.lastError ?? "unknown error"}
          </p>
        ) : null}
      </div>
    </section>
  );
}
