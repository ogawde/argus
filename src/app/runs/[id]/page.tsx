import Link from "next/link";
import { notFound } from "next/navigation";
import { PersonaSwitcher } from "@/components/persona-switcher";
import { FlagActions } from "@/components/run/flag-actions";
import { Button } from "@/components/ui/button";
import { toDecimalString } from "@/domain/money";
import { PlanFileSchema, type PlanLine } from "@/domain/plan";
import { getCurrentActor } from "@/server/auth/demo";
import { prisma } from "@/server/db";
import {
  approveForm,
  bulkAcceptForm,
  rejectForm,
  revokeForm,
  startPlanningForm,
} from "@/server/actions/form";

export const dynamic = "force-dynamic";

const BATCH_LINE_ID = "__BATCH__";

function formatAmount(line: PlanLine): string {
  return `${line.amount.currency} ${toDecimalString(line.amount)}`;
}

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const run = await prisma.payoutRun.findUnique({ where: { id } });
  if (!run) notFound();

  const actor = await getCurrentActor();
  const approval = await prisma.approval.findUnique({ where: { runId: id } });
  const dispositions = await prisma.disposition.findMany({ where: { runId: id } });
  const flags = run.currentPlanHash
    ? await prisma.flag.findMany({ where: { runId: id, planHash: run.currentPlanHash } })
    : [];
  const revision = run.currentPlanHash
    ? await prisma.planRevision.findUnique({
        where: { runId_hash: { runId: id, hash: run.currentPlanHash } },
      })
    : null;
  const plan = revision ? PlanFileSchema.parse(revision.planJson) : null;

  const dispositionByKey = new Map(dispositions.map((d) => [`${d.lineId}|${d.ruleId}`, d]));
  const flagsByLine = new Map<string, typeof flags>();
  for (const flag of flags) {
    flagsByLine.set(flag.lineId, [...(flagsByLine.get(flag.lineId) ?? []), flag]);
  }

  const canEditFlags = run.status === "FLAGGED" || run.status === "READY";
  const openWarnings = flags.filter(
    (f) => !f.blocking && !dispositionByKey.has(`${f.lineId}|${f.ruleId}`),
  );
  const canApprove =
    run.status === "READY" && actor?.role === "APPROVER" && actor.id !== run.preparedById;
  const canReject = ["DRAFT", "FLAGGED", "READY", "APPROVED"].includes(run.status);

  const linesById = new Map((plan?.lines ?? []).map((l) => [l.lineId, l]));
  const flaggedLineIds = [...flagsByLine.keys()];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <Link className="text-sm underline" href="/">
        ← All runs
      </Link>
      <PersonaSwitcher />

      {error ? <p className="rounded border border-red-300 bg-red-50 p-3 text-sm">{error}</p> : null}

      <section className="flex flex-col gap-1 text-sm">
        <h1 className="text-2xl font-semibold">Run {run.id}</h1>
        <p>
          Status: <strong>{run.status}</strong>
        </p>
        <p>
          File: {run.sourceFilename} · Cycle {run.cycleDate.toISOString().slice(0, 10)} · Prepared by{" "}
          {run.preparedById}
        </p>
        <p className="break-all font-mono text-xs">Plan hash: {run.currentPlanHash ?? "— (not planned yet)"}</p>
        {plan ? (
          <p>
            Included: {plan.totals.includedCount} lines, {plan.currency}{" "}
            {toDecimalString({ minor: plan.totals.includedMinor, currency: plan.currency })}
          </p>
        ) : null}
        {approval ? <p>Approved by {approval.approverId}</p> : null}
        {run.status === "FAILED" ? (
          <p className="text-red-700">Failed: {JSON.stringify(run.lastError)}</p>
        ) : null}
      </section>

      <section className="flex flex-wrap items-start gap-3">
        {run.status === "DRAFT" ? (
          <form action={startPlanningForm}>
            <input type="hidden" name="runId" value={run.id} />
            <Button type="submit">Start planning</Button>
          </form>
        ) : null}

        {canEditFlags && openWarnings.length > 0 ? (
          <form action={bulkAcceptForm} className="flex items-center gap-2">
            <input type="hidden" name="runId" value={run.id} />
            <input
              name="reason"
              defaultValue="Reviewed, fine to pay"
              className="w-56 rounded border px-2 py-1 text-sm"
            />
            <Button type="submit" variant="outline">
              Accept {openWarnings.length} warnings
            </Button>
          </form>
        ) : null}

        {canApprove && run.currentPlanHash ? (
          <form action={approveForm}>
            <input type="hidden" name="runId" value={run.id} />
            <input type="hidden" name="planHash" value={run.currentPlanHash} />
            <Button type="submit">Approve plan</Button>
          </form>
        ) : null}

        {run.status === "APPROVED" && actor?.role === "APPROVER" ? (
          <form action={revokeForm}>
            <input type="hidden" name="runId" value={run.id} />
            <Button type="submit" variant="outline">
              Revoke approval
            </Button>
          </form>
        ) : null}

        {canReject ? (
          <form action={rejectForm} className="flex items-center gap-2">
            <input type="hidden" name="runId" value={run.id} />
            <input
              name="reason"
              placeholder="Reject reason"
              required
              minLength={3}
              className="w-48 rounded border px-2 py-1 text-sm"
            />
            <Button type="submit" variant="destructive">
              Reject run
            </Button>
          </form>
        ) : null}
      </section>

      {run.status === "READY" && actor?.role === "APPROVER" && actor.id === run.preparedById ? (
        <p className="text-sm text-neutral-600">You prepared this run, so you cannot approve it.</p>
      ) : null}

      {plan ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Flags ({flags.length})</h2>
            {flags.length === 0 ? <p className="text-sm text-neutral-600">No flags.</p> : null}

            {flaggedLineIds.map((lineId) => {
              const line = linesById.get(lineId);
              return (
                <div key={lineId} className="rounded border p-3 text-sm">
                  <p className="font-medium">
                    {line
                      ? `${line.payeeRef} · ${line.displayName} · ${formatAmount(line)} · ${line.destination.value}`
                      : "Whole batch"}
                  </p>
                  {(flagsByLine.get(lineId) ?? []).map((flag) => {
                    const disposition = dispositionByKey.get(`${flag.lineId}|${flag.ruleId}`);
                    const evidence = flag.evidence as { label: string; value: string | number | boolean }[];
                    return (
                      <div key={flag.id} className="mt-2 flex flex-col gap-1 border-t pt-2">
                        <p>
                          <strong>{flag.ruleId}</strong> · {flag.severity}
                          {flag.blocking ? " · BLOCKING" : ""}
                        </p>
                        <p className="text-xs text-neutral-600">
                          {evidence.map((e) => `${e.label}: ${String(e.value)}`).join(" · ")}
                        </p>
                        {disposition ? (
                          <p className="text-xs">
                            {disposition.action} by {disposition.actorId}: {disposition.reason}
                          </p>
                        ) : null}
                        {canEditFlags && !disposition ? (
                          <FlagActions
                            runId={run.id}
                            lineId={flag.lineId}
                            ruleId={flag.ruleId}
                            canExclude={flag.lineId !== BATCH_LINE_ID}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Lines ({plan.lines.length})</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-1">Row</th>
                  <th>Payee</th>
                  <th>Name</th>
                  <th>Destination</th>
                  <th>Amount</th>
                  <th>Included</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {plan.lines.map((line) => (
                  <tr key={line.lineId} className="border-b">
                    <td className="py-1">{line.sourceRow}</td>
                    <td>
                      {line.payeeRef}
                      {line.payeeId ? "" : " (new)"}
                    </td>
                    <td>{line.displayName}</td>
                    <td>{line.destination.value}</td>
                    <td>{formatAmount(line)}</td>
                    <td>{line.include ? "yes" : "EXCLUDED"}</td>
                    <td>{(flagsByLine.get(line.lineId) ?? []).map((f) => f.ruleId).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </main>
  );
}
