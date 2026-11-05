import Link from "next/link";
import { ArrowLeft, FileUp } from "lucide-react";
import { AppBar } from "@/components/layout/app-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getEnv } from "@/lib/env";
import { getCurrentPersona } from "@/server/auth/demo";
import { createRunForm } from "@/server/actions/form";

export const dynamic = "force-dynamic";

const STEPS = [
  ["Upload", "A CSV with payee_ref, name, email, amount, currency and a note."],
  ["Plan", "Argus checks every line and proposes a plan with its own hash."],
  ["Review", "You decide each flag. Excluding a line re-plans and changes the hash."],
  ["Approve", "A second person signs that exact hash. Then it can be applied."],
];

export default async function NewRunPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const defaultCycleDate = getEnv().DEMO_CYCLE_DATE;
  const persona = await getCurrentPersona();
  const canCreate = persona?.role === "PREPARER";

  return (
    <>
      <AppBar />
      <main className="mx-auto grid max-w-[1100px] gap-12 px-5 py-10 sm:px-8 lg:grid-cols-[1fr_22rem]">
        <section>
          <Link href="/" className="mb-6 flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> All runs
          </Link>
          <p className="eyebrow">Step 1 of 4</p>
          <h1 className="mt-1 font-display text-5xl leading-[1.05] font-semibold tracking-tight text-ink">New payout run</h1>
          <p className="mt-3 max-w-lg text-ink-soft">
            Nothing is paid when you upload. This only creates a draft that you plan and review next.
          </p>

          {error ? (
            <p role="alert" className="mt-6 rounded-lg border border-sev-critical/30 bg-sev-critical-wash px-4 py-2.5 text-sm text-sev-critical">
              {error}
            </p>
          ) : null}

          {!canCreate ? (
            <p role="note" className="mt-6 rounded-lg border border-rule-strong bg-paper-deep/60 px-4 py-3 text-sm text-ink-soft">
              Only a preparer can create runs. Switch to <strong>Maya (preparer)</strong> in the top bar.
            </p>
          ) : null}

          <form action={createRunForm} className="mt-8 flex max-w-lg flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="file" className="text-sm font-medium text-ink">
                CSV file
              </label>
              <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-rule-strong bg-surface/70 p-4">
                <FileUp className="size-6 shrink-0 text-teal" aria-hidden />
                <input
                  id="file"
                  type="file"
                  name="file"
                  accept=".csv,text/csv"
                  required
                  className="w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-surface hover:file:bg-ink-soft"
                />
              </div>
              <p className="text-xs text-ink-faint">
                Demo file: <code className="num rounded bg-paper-deep px-1">data/demo/october-batch.csv</code>
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cycleDate" className="text-sm font-medium text-ink">
                Cycle date
              </label>
              <Input id="cycleDate" type="date" name="cycleDate" defaultValue={defaultCycleDate} required className="w-48" />
              <p className="text-xs text-ink-faint">Rules look back from this date, so the demo uses a fixed one.</p>
            </div>

            <Button type="submit" size="lg" className="self-start" disabled={!canCreate}>
              Upload and create run
            </Button>
          </form>
        </section>

        <aside aria-label="How it works" className="lg:pt-14">
          <h2 className="eyebrow">How a run goes</h2>
          <ol className="mt-3 flex flex-col gap-4 border-l-2 border-rule pl-5">
            {STEPS.map(([title, text], index) => (
              <li key={title} className="relative">
                <span className="num absolute -left-[1.95rem] flex size-6 items-center justify-center rounded-full border-2 border-teal bg-paper text-xs font-bold text-teal-deep">
                  {index + 1}
                </span>
                <p className="font-display text-lg font-semibold text-ink">{title}</p>
                <p className="text-sm text-ink-soft">{text}</p>
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </>
  );
}
