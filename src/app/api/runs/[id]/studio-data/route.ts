import { NextResponse } from "next/server";
import { buildStudioData } from "@/server/studio/build-studio-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One JSON document with everything the run dashboard needs (lines, flags, KPIs, ...). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await buildStudioData(id);
  if (!data) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
