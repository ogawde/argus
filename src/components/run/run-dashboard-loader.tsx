"use client";

import dynamic from "next/dynamic";
import type { StudioData } from "@/domain/studio-data";

// AG Grid, AG Charts and AG Studio only work in the browser, so the whole dashboard is a client-only island.
const RunDashboard = dynamic(() => import("@/components/run/run-dashboard"), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

export function RunDashboardLoader({
  initialData,
  flashError,
}: {
  initialData: StudioData;
  flashError?: string;
}) {
  return <RunDashboard initialData={initialData} flashError={flashError} />;
}

/** Shown while the island downloads. Same rhythm as the real page so nothing jumps. */
function DashboardSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading run">
      <div className="ledger-lines border-b border-rule">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-5 pt-8 pb-7 sm:px-8">
          <div className="h-3 w-56 rounded bg-paper-deep" />
          <div className="h-12 w-96 max-w-full rounded bg-paper-deep" />
          <div className="h-8 w-full rounded bg-paper-deep" />
        </div>
      </div>
      <div className="mx-auto grid max-w-[1500px] grid-cols-2 gap-px px-5 py-4 sm:px-8 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded bg-paper-deep/70" />
        ))}
      </div>
      <div className="mx-auto max-w-[1500px] px-5 sm:px-8">
        <div className="h-96 rounded-xl bg-paper-deep/60" />
      </div>
    </div>
  );
}
