import { StudioSpikeClient } from "./studio-spike-client";

export default function StudioSpikePage() {
  return (
    <main className="min-h-screen p-6">
      <h1 className="mb-4 text-xl font-semibold">AG Studio spike (unlicensed)</h1>
      <p className="mb-6 text-sm text-neutral-600">
        Watermark / console errors are expected per AG Grid hackathon guidance.
      </p>
      <StudioSpikeClient />
    </main>
  );
}
