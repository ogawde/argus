import Link from "next/link";
import { ArrowRight, Plus, RotateCcw } from "lucide-react";
import { AppBar } from "@/components/layout/app-bar";
import { formatDate, formatMoney, plural } from "@/components/run/format";
import { StatusChip } from "@/components/run/status-chip";
import { Button } from "@/components/ui/button";
import { getEnv } from "@/lib/env";
import { resetDemoForm } from "@/server/actions/form";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

/** Totals of the current plan for each run (one query, parsed by hand). */
async function loadRunSummaries() {
  const runs = await prisma.payoutRun.findMany({ orderBy: { createdAt: "desc" } });
  const withPlan = runs.filter((r) => r.currentPlanHash);

  const revisions = withPlan.length
    ? await prisma.planRevision.findMany({
        where: { OR: withPlan.map((r) => ({ runId: r.id, hash: r.currentPlanHash! })) },
        select: { runId: true, planJson: true },
      })
    : [];
  const flags = withPlan.length
    ? await prisma.flag.findMany({
        where: { OR: withPlan.map((r) => ({ runId: r.id, planHash: r.currentPlanHash! })) },
        select: { runId: true, severity: true },
      })
    : [];

  return runs.map((run) => {
    const plan = revisions.find((r) => r.runId === run.id)?.planJson as
      | { currency?: string; totals?: { includedCount: number; includedMinor: number } }
      | undefined;
    const own = flags.filter((f) => f.runId === run.id);
    return {
      run,
      currency: plan?.currency ?? "USD",
      includedCount: plan?.totals?.includedCount ?? null,
      includedMinor: plan?.totals?.includedMinor ?? null,
      critical: own.filter((f) => f.severity === "CRITICAL").length,
      warnings: own.filter((f) => f.severity === "WARN").length,
    };
  });
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const summaries = await loadRunSummaries();
  const isDemo = getEnv().DEMO_MODE;

  return (
    <>
      <AppBar />
      <main className="mx-auto max-w-[1100px] px-5 pb-24 sm:px-8">
        <section className="ledger-lines border-b border-rule py-12">
          <p className="eyebrow">Payout review desk</p>
          <h1 className="mt-2 max-w-3xl font-display text-5xl leading-[1.02] font-semibold tracking-tight text-ink sm:text-6xl">
            Plan before you pay.
          </h1>
          <p className="mt-4 max-w-xl text-base text-ink-soft">
            Upload a payout file, see exactly what would be paid and why anything looks off, get a second pair of eyes to sign
            the plan, then apply it once.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href="/runs/new">
                <Plus /> New run
              </Link>
            </Button>
            {isDemo ? (
              <form action={resetDemoForm}>
                <Button type="submit" variant="outline" size="lg">
                  <RotateCcw /> Reset demo
                </Button>
              </form>
            ) : null}
          </div>
        </section>

        {error ? (
          <p role="alert" className="mt-6 rounded-lg border border-sev-critical/30 bg-sev-critical-wash px-4 py-2.5 text-sm text-sev-critical">
            {error}
          </p>
        ) : null}

        <section className="mt-10" aria-label="Payout runs">
          <h2 className="eyebrow">Runs · {summaries.length}</h2>

          {summaries.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-rule-strong p-10 text-center">
              <p className="font-display text-2xl text-ink">No runs yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink-faint">
                Start with the demo file <code className="num rounded bg-paper-deep px-1">data/demo/october-batch.csv</code>.
              </p>
              <Button asChild className="mt-4">
                <Link href="/runs/new">Create the first run</Link>
              </Button>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-rule border-y border-rule">
              {summaries.map(({ run, currency, includedCount, includedMinor, critical, warnings }) => (
                <li key={run.id}>
                  <Link
                    href={`/runs/${run.id}`}
                    className="group grid items-center gap-x-6 gap-y-1 px-2 py-4 hover:bg-surface/70 focus-visible:outline-2 focus-visible:outline-teal sm:grid-cols-[1fr_auto_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-display text-2xl font-semibold text-ink">{run.sourceFilename}</p>
                      <p className="text-sm text-ink-soft">
                        Cycle {formatDate(run.cycleDate.toISOString())} · prepared by {run.preparedById} ·{" "}
                        <span className="num text-xs text-ink-faint">{run.id.slice(0, 10)}</span>
                      </p>
                    </div>
                    <div className="text-sm text-ink-soft sm:text-right">
                      {includedMinor !== null && includedCount !== null ? (
                        <>
                          <p className="num text-base text-ink">{formatMoney(includedMinor, currency)}</p>
                          <p>
                            {plural(includedCount, "line")}
                            {critical + warnings > 0 ? ` · ${critical} critical, ${warnings} warning` : ""}
                          </p>
                        </>
                      ) : (
                        <p className="text-ink-faint">not planned yet</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 sm:justify-end">
                      <StatusChip status={run.status} />
                      <ArrowRight className="size-4 text-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-teal" aria-hidden />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
