import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planHash } from "@/domain/hash";
import type { PlanFile } from "@/domain/plan";
import { applyConfirmText } from "@/domain/paypal-ids";
import { executeApply } from "@/server/apply/execute";
import { createPayPalClient } from "@/server/paypal/client";
import { prisma } from "@/server/db";
import { startFakePayPal } from "../../scripts/fake-paypal/server";

const lineId = "Labc123def456";

function planFor(runId: string, note: string, master = 1): PlanFile {
  return {
    schemaVersion: 1,
    kind: "payout-plan",
    runId,
    parentHash: null,
    source: { filename: "tiny.csv", sha256: "abc", rowCount: 1 },
    cycleDate: "2026-10-28",
    baseline: { payeeMasterVersion: master, historyWatermark: "2026-10-01T00:00:00.000Z", policyVersion: "policy.v1" },
    currency: "USD",
    lines: [
      {
        lineId,
        sourceRow: 2,
        payeeRef: "P-TEST",
        payeeId: null,
        displayName: "Test Payee",
        destination: { type: "EMAIL", value: "payee@example.com" },
        amount: { minor: 100, currency: "USD" },
        note,
        include: true,
      },
    ],
    totals: { includedCount: 1, includedMinor: 100 },
  };
}

describe("apply against fake PayPal", () => {
  let url = "";
  let posts = () => 0;
  let close: () => Promise<void> = async () => {};
  const runIds: string[] = [];

  beforeAll(async () => {
    const fake = await startFakePayPal();
    url = fake.url;
    posts = fake.posts;
    close = () => new Promise((resolve) => fake.server.close(() => resolve()));
  });

  afterAll(async () => {
    await prisma.payoutItem.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.applyAttempt.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.appliedPlan.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.approval.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.planRevision.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.payoutRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.$disconnect();
    await close();
  });

  async function seedApproved(label: string, master = 1) {
    const run = await prisma.payoutRun.create({
      data: {
        status: "APPROVED",
        preparedById: "maya",
        cycleDate: new Date("2026-10-28T00:00:00.000Z"),
        sourceFilename: `${label}.csv`,
        sourceSha256: `sha-${label}-${Date.now()}`,
        payeeMasterVersion: master,
      },
    });
    const plan = planFor(run.id, label, master);
    const hash = planHash(plan);
    await prisma.planRevision.create({
      data: {
        runId: run.id,
        hash,
        planJson: plan,
        createdById: "maya",
      },
    });
    await prisma.payoutRun.update({ where: { id: run.id }, data: { currentPlanHash: hash } });
    await prisma.approval.create({
      data: { runId: run.id, planHash: hash, analysisHash: hash, approverId: "daniel" },
    });
    runIds.push(run.id);
    return { runId: run.id, hash };
  }

  function paypal() {
    return createPayPalClient({
      baseUrl: url,
      clientId: "id",
      clientSecret: "secret",
      timeoutMs: 400,
      maxRetries: 0,
    });
  }

  it("submits once and a second click is a no-op", async () => {
    process.env.FAKE_PAYPAL_MODE = "success";
    const before = posts();
    const { runId, hash } = await seedApproved("ok");
    const first = await executeApply({
      runId,
      planHash: hash,
      confirmText: applyConfirmText(hash),
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.data.attemptStatus).toBe("SUBMITTED");
      expect(first.data.paypalBatchId).toBe("FAKEBATCH1");
    }
    const second = await executeApply({
      runId,
      planHash: hash,
      confirmText: applyConfirmText(hash),
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(second.ok && second.data.alreadyApplied).toBe(true);
    expect(posts() - before).toBe(1);
  });

  it("rejects a bad confirm phrase and the preparer", async () => {
    process.env.FAKE_PAYPAL_MODE = "success";
    const { runId, hash } = await seedApproved("auth");
    const bad = await executeApply({
      runId,
      planHash: hash,
      confirmText: "APPLY nope",
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(bad.ok).toBe(false);
    const preparer = await executeApply({
      runId,
      planHash: hash,
      confirmText: applyConfirmText(hash),
      actor: { id: "maya", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(preparer.ok).toBe(false);
    if (!preparer.ok) expect(preparer.code).toBe("FORBIDDEN");
  });

  it("marks a validation 4xx as FAILED and releases the plan", async () => {
    process.env.FAKE_PAYPAL_MODE = "validation";
    const { runId, hash } = await seedApproved("bad");
    const result = await executeApply({
      runId,
      planHash: hash,
      confirmText: applyConfirmText(hash),
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(result.ok).toBe(false);
    const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe("FAILED");
    const applied = await prisma.appliedPlan.findUnique({ where: { planHash: hash } });
    expect(applied).toBeNull();
  });

  it("adopts the existing batch id on a duplicate sender_batch_id", async () => {
    process.env.FAKE_PAYPAL_MODE = "duplicate";
    const { runId, hash } = await seedApproved("dup");
    const result = await executeApply({
      runId,
      planHash: hash,
      confirmText: applyConfirmText(hash),
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.paypalBatchId).toBe("FAKEBATCH1");
  });

  it("leaves the run APPLYING and uncertain when PayPal times out", async () => {
    process.env.FAKE_PAYPAL_MODE = "timeout";
    const { runId, hash } = await seedApproved("timeout");
    const result = await executeApply({
      runId,
      planHash: hash,
      confirmText: applyConfirmText(hash),
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(result.ok && result.data.attemptStatus).toBe("UNCERTAIN");
    const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe("APPLYING");
  });

  it("two parallel applies produce exactly one PayPal POST", async () => {
    process.env.FAKE_PAYPAL_MODE = "success";
    const before = posts();
    const { runId, hash } = await seedApproved("race");
    const [a, b] = await Promise.all([
      executeApply({
        runId,
        planHash: hash,
        confirmText: applyConfirmText(hash),
        actor: { id: "daniel", role: "APPROVER" },
        paypal: paypal(),
      }),
      executeApply({
        runId,
        planHash: hash,
        confirmText: applyConfirmText(hash),
        actor: { id: "daniel", role: "APPROVER" },
        paypal: paypal(),
      }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(posts() - before).toBe(1);
  });

  it("refuses the same plan content in a second run", async () => {
    process.env.FAKE_PAYPAL_MODE = "success";
    const first = await seedApproved("shared-plan");
    const okFirst = await executeApply({
      runId: first.runId,
      planHash: first.hash,
      confirmText: applyConfirmText(first.hash),
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(okFirst.ok).toBe(true);
    const second = await seedApproved("shared-plan");
    expect(second.hash).toBe(first.hash);
    const blocked = await executeApply({
      runId: second.runId,
      planHash: second.hash,
      confirmText: applyConfirmText(second.hash),
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("ALREADY_APPLIED_PLAN");
  });

  it("returns the run to DRAFT when the payee master drifted", async () => {
    const { runId, hash } = await seedApproved("drift", 99);
    const result = await executeApply({
      runId,
      planHash: hash,
      confirmText: applyConfirmText(hash),
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STALE_PLAN");
    const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe("DRAFT");
  });

  it("refuses a tampered stored plan", async () => {
    const { runId, hash } = await seedApproved("tamper");
    const rev = await prisma.planRevision.findUnique({ where: { runId_hash: { runId, hash } } });
    const json = rev!.planJson as { lines: Array<{ note: string }> };
    json.lines[0]!.note = "tampered";
    await prisma.planRevision.update({
      where: { runId_hash: { runId, hash } },
      data: { planJson: json },
    });
    const result = await executeApply({
      runId,
      planHash: hash,
      confirmText: applyConfirmText(hash),
      actor: { id: "daniel", role: "APPROVER" },
      paypal: paypal(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TAMPERED_PLAN");
  });
});
