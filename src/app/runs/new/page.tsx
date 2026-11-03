import Link from "next/link";
import { PersonaSwitcher } from "@/components/persona-switcher";
import { Button } from "@/components/ui/button";
import { getEnv } from "@/lib/env";
import { createRunForm } from "@/server/actions/form";

export const dynamic = "force-dynamic";

export default async function NewRunPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const defaultCycleDate = getEnv().DEMO_CYCLE_DATE;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <Link className="text-sm underline" href="/">
        ← All runs
      </Link>
      <h1 className="text-2xl font-semibold">New payout run</h1>
      <PersonaSwitcher />

      {error ? <p className="rounded border border-red-300 bg-red-50 p-3 text-sm">{error}</p> : null}

      <form action={createRunForm} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          CSV file (payee_ref, name, email, amount, currency, note)
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Cycle date
          <input
            type="date"
            name="cycleDate"
            defaultValue={defaultCycleDate}
            required
            className="rounded border px-2 py-1"
          />
        </label>
        <Button type="submit">Upload and create run</Button>
      </form>
      <p className="text-xs text-neutral-500">Demo file: data/demo/october-batch.csv</p>
    </main>
  );
}
