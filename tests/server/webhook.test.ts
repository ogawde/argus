import { afterAll, describe, expect, it } from "vitest";
import { planHash } from "@/domain/hash";
import type { PlanFile } from "@/domain/plan";
import { senderBatchId, senderItemId } from "@/domain/paypal-ids";
import { ingestWebhook } from "@/server/paypal/ingest-webhook";
import { webhookAuthorized } from "@/server/paypal/verify";
import { prisma } from "@/server/db";

const lineId = "Labc123def456";

function planFor(runId: string): PlanFile {
  return {
    schemaVersion: 1,
    kind: "payout-plan",
    runId,
    parentHash: null,
    source: { filename: "hook.csv", sha256: "abc", rowCount: 1 },
    cycleDate: "2026-10-28",
    baseline: { payeeMasterVersion: 1, historyWatermark: "2026-10-01T00:00:00.000Z", policyVersion: "policy.v1" },
    currency: "USD",
    lines: [
      {
        lineId,
        sourceRow: 2,
        payeeRef: "P-HOOK",
        payeeId: null,
        displayName: "Hook Payee",
        destination: { type: "EMAIL", value: "hook@example.com" },
        amount: { minor: 100, currency: "USD" },
        note: "webhook",
        include: true,
      },
    ],
    totals: { includedCount: 1, includedMinor: 100 },
  };
}

describe("webhook ingest", () => {
  const runIds: string[] = [];
  const eventIds: string[] = [];

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.payoutItem.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.applyAttempt.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.planRevision.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.payoutRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.$disconnect();
  });

  async function seedApplying() {
    const run = await prisma.payoutRun.create({
      data: {
        status: "APPLYING",
        preparedById: "maya",
        cycleDate: new Date("2026-10-28T00:00:00.000Z"),
        sourceFilename: "hook.csv",
        sourceSha256: `hook-${Date.now()}`,
        payeeMasterVersion: 1,
      },
    });
    runIds.push(run.id);
    const plan = planFor(run.id);
    const hash = planHash(plan);
    await prisma.planRevision.create({ data: { runId: run.id, hash, planJson: plan, createdById: "maya" } });
    const batchId = senderBatchId(run.id, hash);
    await prisma.payoutRun.update({ where: { id: run.id }, data: { currentPlanHash: hash } });
    await prisma.applyAttempt.create({
      data: {
        runId: run.id,
        planHash: hash,
        senderBatchId: batchId,
        requestBody: {},
        status: "SUBMITTED",
        paypalBatchId: "BATCH1",
      },
    });
    await prisma.payoutItem.create({
      data: {
        runId: run.id,
        lineId,
        senderItemId: senderItemId(batchId, lineId),
        status: "PENDING",
        amountMinor: 100,
        receiverActual: "hook@example.com",
      },
    });
    return { runId: run.id, sender: senderItemId(batchId, lineId) };
  }

  it("rejects a strict webhook that has no signature headers", () => {
    expect(
      webhookAuthorized({
        verify: "strict",
        nodeEnv: "production",
        webhookId: "WH",
        transmissionId: null,
        transmissionSig: null,
        transmissionTime: null,
      }),
    ).toBe(false);
    expect(
      webhookAuthorized({
        verify: "off",
        nodeEnv: "production",
        transmissionId: null,
        transmissionSig: null,
        transmissionTime: null,
      }),
    ).toBe(false);
  });

  it("returns 500 when the item does not exist yet, then processes the retry", async () => {
    const { sender } = await seedApplying();
    const earlyId = `evt-early-${Date.now()}`;
    eventIds.push(earlyId);
    const early = await ingestWebhook(
      { id: earlyId, event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_item: { sender_item_id: "missing-item" } } },
      true,
    );
    expect(early.httpStatus).toBe(500);

    const okId = `evt-ok-${Date.now()}`;
    eventIds.push(okId);
    const body = {
      id: okId,
      event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      resource: { payout_item: { sender_item_id: sender }, payout_item_id: "ITEM1" },
    };
    const first = await ingestWebhook(body, true);
    const second = await ingestWebhook(body, true);
    expect(first.httpStatus).toBe(200);
    expect(second.duplicate).toBe(true);
  });

  it("does not move SUCCESS back to PROCESSING", async () => {
    const { runId, sender } = await seedApplying();
    const successId = `evt-success-${Date.now()}`;
    const lateId = `evt-late-${Date.now()}`;
    eventIds.push(successId, lateId);
    await ingestWebhook(
      { id: successId, event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_item: { sender_item_id: sender } } },
      true,
    );
    await ingestWebhook(
      { id: lateId, event_type: "PAYMENT.PAYOUTS-ITEM.HELD", resource: { payout_item: { sender_item_id: sender } } },
      true,
    );
    const item = await prisma.payoutItem.findUnique({ where: { senderItemId: sender } });
    const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
    expect(item?.status).toBe("SUCCESS");
    expect(run?.status).toBe("RECONCILED");
    expect(run?.reconciliationOutcome).toBe("CLEAN");
  });
});
