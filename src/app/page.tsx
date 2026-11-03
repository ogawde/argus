import Link from "next/link";
import { PersonaSwitcher } from "@/components/persona-switcher";
import { Button } from "@/components/ui/button";
import { getEnv } from "@/lib/env";
import { prisma } from "@/server/db";
import { resetDemoForm } from "@/server/actions/form";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const runs = await prisma.payoutRun.findMany({ orderBy: { createdAt: "desc" } });
  const isDemo = getEnv().DEMO_MODE;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Argus payout runs</h1>
        <p className="text-sm text-amber-700">SANDBOX MODE — no real money.</p>
        <PersonaSwitcher />
      </header>

      {error ? <p className="rounded border border-red-300 bg-red-50 p-3 text-sm">{error}</p> : null}

      <div className="flex gap-2">
        <Button asChild>
          <Link href="/runs/new">New run</Link>
        </Button>
        {isDemo ? (
          <form action={resetDemoForm}>
            <Button type="submit" variant="outline">
              Reset demo
            </Button>
          </form>
        ) : null}
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-neutral-600">No runs yet. Create one with the demo CSV.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Run</th>
              <th>Status</th>
              <th>File</th>
              <th>Cycle</th>
              <th>Prepared by</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b">
                <td className="py-2">
                  <Link className="underline" href={`/runs/${run.id}`}>
                    {run.id.slice(0, 10)}…
                  </Link>
                </td>
                <td>{run.status}</td>
                <td>{run.sourceFilename}</td>
                <td>{run.cycleDate.toISOString().slice(0, 10)}</td>
                <td>{run.preparedById}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
