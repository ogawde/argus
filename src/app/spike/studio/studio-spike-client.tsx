"use client";

import dynamic from "next/dynamic";

const StudioSpike = dynamic(() => import("@/components/studio/studio-spike"), {
  ssr: false,
  loading: () => <p className="p-8">Loading AG Studio spike…</p>,
});

export function StudioSpikeClient() {
  return <StudioSpike />;
}
