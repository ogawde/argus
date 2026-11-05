import { prisma } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 1500;
/** The browser's EventSource reconnects by itself when we close, so a limit keeps connections tidy. */
const MAX_STREAM_MS = 2 * 60 * 1000;

/** What the dashboard needs to know to decide whether to refetch. */
async function readSnapshot(runId: string) {
  const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
  if (!run) return null;

  const flags = run.currentPlanHash
    ? await prisma.flag.findMany({
        where: { runId, planHash: run.currentPlanHash },
        select: { rationale: true },
      })
    : [];

  return {
    status: run.status,
    planHash: run.currentPlanHash,
    flagCount: flags.length,
    rationaleCount: flags.filter((f) => f.rationale !== null).length,
  };
}

/**
 * Server-sent events for one run.
 *   status           → sent first, then whenever status / plan hash / flag count changes
 *   rationale.ready  → sent first, then whenever the number of flags with an AI rationale changes
 * The dashboard only uses these as a hint to refetch /studio-data.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const close = () => {
        if (isClosed) return;
        isClosed = true;
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const send = (event: string, data: unknown) => {
        if (isClosed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      req.signal.addEventListener("abort", close);

      let lastStatusKey = "";
      let lastRationaleCount = -1;
      const startedAt = Date.now();

      try {
        while (!isClosed && Date.now() - startedAt < MAX_STREAM_MS) {
          const snapshot = await readSnapshot(id);
          if (!snapshot) {
            send("error", { message: "not found" });
            break;
          }

          const statusKey = `${snapshot.status}|${snapshot.planHash}|${snapshot.flagCount}`;
          if (statusKey !== lastStatusKey) {
            lastStatusKey = statusKey;
            send("status", snapshot);
          }
          if (snapshot.rationaleCount !== lastRationaleCount) {
            lastRationaleCount = snapshot.rationaleCount;
            send("rationale.ready", { count: snapshot.rationaleCount });
          }

          // comment line = keep-alive, ignored by EventSource
          if (!isClosed) controller.enqueue(encoder.encode(": ping\n\n"));
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        close();
      }
    },
    cancel() {
      isClosed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
