import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import { verifyAuditChain } from "@/domain/audit";
import { AppBar } from "@/components/layout/app-bar";
import { formatDateTime, shortHash } from "@/components/run/format";
import { StatusChip } from "@/components/run/status-chip";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

/** Plain-English names for the audit event types we write. */
const EVENT_LABEL: Record<string, string> = {
  RUN_CREATED: "Run created",
  PLAN_CREATED: "Plan created",
  PLANNING_FAILED: "Planning failed",
  FLAG_ACCEPTED: "Flag accepted",
  FLAG_EXCLUDED: "Line excluded",
  WARNINGS_BULK_ACCEPTED: "Warnings bulk-accepted",
  PLAN_APPROVED: "Plan approved",
  APPROVAL_REVOKED: "Approval revoked",
  RUN_REJECTED: "Run rejected",
};

/** "key: value" bits for the details column. Hashes are shortened. */
function describe(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  return Object.entries(data as Record<string, unknown>).map(([key, value]) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return `${key}: ${text.startsWith("sha256:") ? shortHash(text) : text}`;
  });
}

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await prisma.payoutRun.findUnique({ where: { id } });
  if (!run) notFound();

  // The chain is global (every run links to the event before it), so verify all rows, then show this run's.
  const all = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" } });
  const brokenAt = verifyAuditChain(all);
  const events = all.filter((e) => e.runId === id);

  return (
    <>
      <AppBar />
      <main className="mx-auto max-w-[1200px] px-5 pb-24 sm:px-8">
        <section className="ledger-lines border-b border-rule pt-8 pb-8">
          <Link href={`/runs/${id}`} className="mb-4 flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Back to run
          </Link>
          <p className="eyebrow">Audit trail</p>
          <h1 className="mt-1 break-words font-display text-4xl leading-tight font-semibold tracking-tight text-ink sm:text-5xl">
            {run.sourceFilename}
          </h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
            <StatusChip status={run.status} />
            <span className="num text-xs">{run.id}</span>
          </p>

          {brokenAt === null ? (
            <p role="status" className="mt-5 flex w-fit items-center gap-2 rounded-lg border border-ok/30 bg-ok-wash px-3 py-2 text-sm text-ok">
              <ShieldCheck className="size-4" aria-hidden />
              <span>
                <strong>✓ Chain intact.</strong> {all.length} events checked, each one hashed with the event before it.
              </span>
            </p>
          ) : (
            <p role="alert" className="mt-5 flex w-fit items-center gap-2 rounded-lg border border-sev-critical/30 bg-sev-critical-wash px-3 py-2 text-sm text-sev-critical">
              <ShieldAlert className="size-4" aria-hidden />
              <span>
                <strong>✗ Chain broken at event #{brokenAt}.</strong> Something was changed after it was written.
              </span>
            </p>
          )}
        </section>

        {events.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-rule-strong p-8 text-center text-sm text-ink-faint">
            No audit events for this run yet.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <caption className="sr-only">Audit events for this run, oldest first</caption>
              <thead>
                <tr className="border-b border-rule-strong text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                  <th scope="col" className="py-2 pr-3 font-semibold">#</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">When</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Who</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Event</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Details</th>
                  <th scope="col" className="py-2 font-semibold">Hash</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={String(event.seq)} className="border-b border-rule align-top">
                    <td className="num py-3 pr-3 text-ink-faint">{String(event.seq)}</td>
                    <td className="py-3 pr-3 whitespace-nowrap text-ink-soft">{formatDateTime(event.at.toISOString())}</td>
                    <td className="py-3 pr-3 font-medium text-ink">{event.actorId}</td>
                    <td className="py-3 pr-3">
                      <span className="font-semibold text-ink">{EVENT_LABEL[event.type] ?? event.type}</span>
                      <span className="num block text-[0.6875rem] text-ink-faint">{event.type}</span>
                    </td>
                    <td className="py-3 pr-3">
                      <ul className="flex flex-col gap-0.5 text-xs text-ink-soft">
                        {describe(event.data).map((line) => (
                          <li key={line} className="num break-all">{line}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-3">
                      <code className="num block text-xs text-ink" title={event.hash}>{shortHash(event.hash)}</code>
                      <code className="num block text-[0.6875rem] text-ink-faint" title={event.prevHash}>
                        ← {shortHash(event.prevHash)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
