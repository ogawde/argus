import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { pingElasticsearch } from "@/server/elastic/client";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = { ok: true };
  } catch (err) {
    checks.postgres = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const es = await pingElasticsearch();
  checks.elasticsearch = es.ok
    ? { ok: true, detail: es.version }
    : { ok: false, detail: es.error };

  // Embedding model warm-up is deferred to Phase 3 spike; report as skipped for now.
  checks.embeddings = { ok: true, detail: "deferred-to-spike" };

  const healthy = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      ts: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
