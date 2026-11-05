import { afterAll, describe, expect, it } from "vitest";
import { planHash } from "@/domain/hash";
import type { PlanFile } from "@/domain/plan";
import { applyConfirmText } from "@/domain/paypal-ids";
import { getEnv } from "@/lib/env";
import { executeApply } from "@/server/apply/execute";
import { prisma } from "@/server/db";

const enabled = process.env.PAYPAL_SANDBOX_TEST === "1";
const runIds: string[] = [];

function threeLinePlan(runId: string): PlanFile {
  const lines = [1, 2, 3].map((n) => ({
    lineId: `L00000000000${n}` as const,
    sourceRow: n + 1,
    payeeRef: `P-SBX-${n}`,
    payeeId: null,
    displayName: `Sandbox ${n}`,
    destination: { type: "EMAIL" as const, value: `sandbox-${n}@example.com` },
    amount: { minor: 100, currency: "USD" as const },
    note: `sandbox-${runId}-${n}`,
    include: true,
  }));
  return {
    schemaVersion: 1,
    kind: "payout-plan",
    runId,
    parentHash: null,
    source: { filename: "sandbox.csv", sha256: runId, rowCount: 3 },
    cycleDate: "2026-10-28",
    baseline: {
      payeeMasterVersion: 1,
      historyWatermark: "2026-10-01T00:00:00.000Z",
      policyVersion: "policy.v1",
    },
    currency: "USD",
    lines,
    totals: { includedCount: 3, includedMinor: 300 },
  };
}

describe.skipIf(!enabled)("real sandbox 3-line apply", () => {
  afterAll(async () => {
    if (runIds.length === 0) return;
    await prisma.payoutItem.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.applyAttempt.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.appliedPlan.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.approval.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.planRevision.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.payoutRun.deleteMany({ where: { id: { in: runIds } } });
  });

  it("creates a PayPal batch for three $1 items", async () => {
    const env = getEnv();
    expect(env.PAYPAL_CLIENT_ID).toBeTruthy();
    const newest = await prisma.payee.aggregate({ _max: { version: true } });
    const master = newest._max.version ?? 1;
    const run = await prisma.payoutRun.create({
      data: {
        status: "APPROVED",
        preparedById: "maya",
        cycleDate: new Date("2026-10-28T00:00:00.000Z"),
        sourceFilename: "sandbox-3.csv",
        sourceSha256: `sandbox-${Date.now()}`,
        payeeMasterVersion: master,
      },
    });
    runIds.push(run.id);
    const plan = threeLinePlan(run.id);
    plan.baseline.payeeMasterVersion = master;
    const hash = planHash(plan);
    await prisma.planRevision.create({
      data: { runId: run.id, hash, planJson: plan, createdById: "maya" },
    });
    await prisma.payoutRun.update({ where: { id: run.id }, data: { currentPlanHash: hash } });
    await prisma.approval.create({
      data: { runId: run.id, planHash: hash, analysisHash: hash, approverId: "daniel" },
    });

    const result = await executeApply({
      runId: run.id,
      planHash: hash,
      confirmText: applyConfirmText(hash),
      actor: { id: "daniel", role: "APPROVER" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.paypalBatchId).toBeTruthy();
      expect(result.data.attemptStatus).toBe("SUBMITTED");
    }
  }, 60_000);
});
