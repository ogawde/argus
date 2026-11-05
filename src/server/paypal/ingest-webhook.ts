import type { Prisma } from "@prisma/client";
import { senderItemId } from "@/domain/paypal-ids";
import { canAdvanceStatus, reconcile } from "@/domain/reconcile";
import { PlanFileSchema } from "@/domain/plan";
import { prisma } from "@/server/db";
import { parsePayoutEvent } from "@/server/paypal/events";

export interface IngestResult {
  httpStatus: number;
  duplicate: boolean;
  processed: boolean;
}

/** Store one webhook and apply it if we already know the payout item. */
export async function ingestWebhook(body: unknown, verified: boolean): Promise<IngestResult> {
  const parsed = parsePayoutEvent(body);
  if (!parsed) return { httpStatus: 400, duplicate: false, processed: false };

  const inserted = await prisma.webhookEvent.createMany({
    data: [
      {
        eventId: parsed.eventId,
        eventType: parsed.eventType,
        resourceId: parsed.paypalItemId ?? parsed.paypalBatchId,
        verified,
        payload: body as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0) return { httpStatus: 200, duplicate: true, processed: false };

  const applied = await applyParsedEvent(parsed);
  if (!applied) {
    await prisma.webhookEvent.update({
      where: { eventId: parsed.eventId },
      data: { processingError: "item not known yet" },
    });
    return { httpStatus: 500, duplicate: false, processed: false };
  }

  await prisma.webhookEvent.update({
    where: { eventId: parsed.eventId },
    data: { processedAt: new Date(), processingError: null },
  });
  return { httpStatus: 200, duplicate: false, processed: true };
}

async function applyParsedEvent(parsed: NonNullable<ReturnType<typeof parsePayoutEvent>>): Promise<boolean> {
  if (parsed.batchStatus === "DENIED" && parsed.paypalBatchId) {
    const attempt = await prisma.applyAttempt.findFirst({ where: { paypalBatchId: parsed.paypalBatchId } });
    if (!attempt) return false;
    await prisma.payoutRun.update({
      where: { id: attempt.runId },
      data: { status: "FAILED", reconciliationOutcome: null, lastError: { batch: "DENIED" } },
    });
    return true;
  }

  if (!parsed.itemStatus || !parsed.senderItemId) {
    // Batch-only events are stored and acknowledged.
    return true;
  }

  const item = await prisma.payoutItem.findUnique({ where: { senderItemId: parsed.senderItemId } });
  if (!item) return false;
  if (canAdvanceStatus(item.status, parsed.itemStatus)) {
    await prisma.payoutItem.update({
      where: { id: item.id },
      data: {
        status: parsed.itemStatus,
        paypalItemId: parsed.paypalItemId ?? item.paypalItemId,
        lastEventAt: new Date(),
        source: "webhook",
      },
    });
  }
  await settleRun(item.runId);
  return true;
}

/** Move APPLYING → RECONCILED or FAILED once every included item is terminal. */
export async function settleRun(runId: string): Promise<void> {
  const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
  if (!run?.currentPlanHash || run.status !== "APPLYING") return;
  const revision = await prisma.planRevision.findUnique({
    where: { runId_hash: { runId, hash: run.currentPlanHash } },
  });
  if (!revision) return;
  const plan = PlanFileSchema.parse(revision.planJson);
  const attempt = await prisma.applyAttempt.findUnique({ where: { runId } });
  const batchId = attempt?.senderBatchId ?? "";
  const items = await prisma.payoutItem.findMany({ where: { runId } });
  const report = reconcile(
    plan.lines.map((line) => ({
      lineId: line.lineId,
      senderItemId: senderItemId(batchId, line.lineId),
      amountMinor: line.amount.minor,
      include: line.include,
    })),
    items.map((item) => ({
      senderItemId: item.senderItemId,
      lineId: item.lineId,
      amountMinor: item.amountMinor,
      status: item.status,
    })),
  );
  if (!report.settled) return;
  await prisma.payoutRun.update({
    where: { id: runId },
    data: {
      status: report.outcome === "FAILED" ? "FAILED" : "RECONCILED",
      reconciliationOutcome: report.outcome === "FAILED" ? null : report.outcome,
    },
  });
}
