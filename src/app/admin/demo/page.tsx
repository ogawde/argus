import { notFound } from "next/navigation";
import { getEnv } from "@/lib/env";

/** Dev-only controls. Disabled in production. */
export default function AdminDemoPage() {
  const env = getEnv();
  if (env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="font-display text-3xl">Demo controls</h1>
      <p className="mt-3 text-sm text-ink-soft">
        LLM mode is <span className="num">{env.LLM_MODE}</span>. Change it in <span className="num">.env.local</span> and restart.
        Replay a stored PayPal event by posting the saved JSON to <span className="num">/api/webhooks/paypal</span>.
      </p>
    </main>
  );
}
