import { notFound } from "next/navigation";
import { AppBar } from "@/components/layout/app-bar";
import { RunDashboardLoader } from "@/components/run/run-dashboard-loader";
import { buildStudioData } from "@/server/studio/build-studio-data";

export const dynamic = "force-dynamic";

/** Review dashboard for one run. The page loads the data on the server; the dashboard itself is a client island. */
export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const data = await buildStudioData(id);
  if (!data) notFound();

  return (
    <>
      <AppBar />
      <RunDashboardLoader initialData={data} flashError={error} />
    </>
  );
}
