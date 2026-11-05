import { planHash } from "@/domain/hash";
import type { Currency } from "@/domain/money";
import { PlanFileSchema, type PlanFile } from "@/domain/plan";
import { applyConfirmText, senderBatchId, senderItemId } from "@/domain/paypal-ids";
import { loadPolicy } from "@/domain/policy";
import { appendAudit } from "@/server/audit";
import type { Actor } from "@/domain/state";
import { getEnv } from "@/lib/env";
import { createPayPalClient, type PayPalClient } from "@/server/paypal/client";
import { prisma } from "@/server/db";

export interface ApplyOutcome {
  status: string;
  attemptStatus: string;
  paypalBatchId: string | null;
  senderBatchId: string;
  alreadyApplied: boolean;
  message: string;
}

function clientFromEnv(): PayPalClient {
  const env = getEnv();
  return createPayPalClient({
    baseUrl: env.PAYPAL_API_BASE,
    clientId: env.PAYPAL_CLIENT_ID || "missing",
    clientSecret: env.PAYPAL_CLIENT_SECRET || "missing",
  });
}

function remapReceiver(args: {
  email: string;
  payeeId: string | null;
  index: number;
  pool: string[];
  remapOff: Set<string>;
  live: boolean;
}): string {
  if (args.live || args.pool.length === 0) return args.email;
  if (args.payeeId && args.remapOff.has(args.payeeId)) return args.email;
  return args.pool[args.index % args.pool.length]!;
}

async function loadPlan(runId: string, hash: string): Promise<PlanFile | null> {
  const rev = await prisma.planRevision.findUnique({ where: { runId_hash: { runId, hash } } });
  if (!rev) return null;
  return PlanFileSchema.parse(rev.planJson);
}

export async function executeApply(args: {
  runId: string;
  planHash: string;
  confirmText: string;
  actor: Actor;
  paypal?: PayPalClient;
}): Promise<{ ok: true; data: ApplyOutcome } | { ok: false; code: string; message: string }> {
  const { runId, actor } = args;
  const expected = applyConfirmText(args.planHash);
  if (args.confirmText.trim().toUpperCase() !== expected.toUpperCase()) {
    return { ok: false, code: "BAD_CONFIRM", message: `Type ${expected} to apply.` };
  }
  if (actor.role !== "APPROVER" || actor.id === (await prisma.payoutRun.findUnique({ where: { id: runId } }))?.preparedById) {
    return { ok: false, code: "FORBIDDEN", message: "Only an approver who did not prepare this run can apply." };
  }

  const paypal = args.paypal ?? clientFromEnv();
  const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
  if (!run) return { ok: false, code: "NOT_FOUND", message: "Run not found." };
  if (run.currentPlanHash !== args.planHash) {
    return { ok: false, code: "HASH_MISMATCH", message: "That plan hash is not the current plan." };
  }

  const existing = await prisma.applyAttempt.findUnique({ where: { runId } });
  if (run.status === "APPLYING" || run.status === "RECONCILED") {
    if (!existing) return { ok: false, code: "BAD_STATE", message: `Run is ${run.status} without an attempt.` };
    if (existing.status === "PREPARED") {
      return submitPrepared(runId, args.planHash, existing.senderBatchId, paypal);
    }
    return {
      ok: true,
      data: {
        status: run.status,
        attemptStatus: existing.status,
        paypalBatchId: existing.paypalBatchId,
        senderBatchId: existing.senderBatchId,
        alreadyApplied: true,
        message: existing.paypalBatchId
          ? `Already applied: batch id ${existing.paypalBatchId}`
          : "Already applied. No second payout was sent.",
      },
    };
  }

  if (run.status !== "APPROVED") {
    return { ok: false, code: "BAD_STATE", message: `Cannot apply while run is ${run.status}.` };
  }

  const plan = await loadPlan(runId, args.planHash);
  if (!plan) return { ok: false, code: "NO_PLAN", message: "Stored plan is missing." };
  if (planHash(plan) !== args.planHash) {
    return { ok: false, code: "TAMPERED_PLAN", message: "Stored plan does not match its hash." };
  }

  const policy = loadPolicy();
  const newest = await prisma.payee.aggregate({ _max: { version: true } });
  const master = newest._max.version ?? 1;
  const stale =
    plan.baseline.payeeMasterVersion !== run.payeeMasterVersion ||
    plan.baseline.payeeMasterVersion !== master ||
    plan.baseline.policyVersion !== policy.version;
  if (stale) {
    await prisma.$transaction(async (tx) => {
      await tx.payoutRun.update({ where: { id: runId }, data: { status: "DRAFT" } });
      await tx.approval.deleteMany({ where: { runId } });
      await appendAudit(tx, { actorId: actor.id, type: "STALE_PLAN", runId, data: { planHash: args.planHash } });
    });
    return { ok: false, code: "STALE_PLAN", message: "Payee data changed since approval. Plan again." };
  }

  const batchId = senderBatchId(runId, args.planHash);
  const env = getEnv();
  const pool = (env.SANDBOX_RECEIVER_POOL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const live = env.PAYPAL_ENV === "live";
  const included = plan.lines.filter((l) => l.include);
  const remapOffRows = await prisma.payee.findMany({
    where: { sandboxRemap: false, id: { in: included.map((l) => l.payeeId).filter(Boolean) as string[] } },
    select: { id: true },
  });
  const remapOff = new Set(remapOffRows.map((p) => p.id));

  const items = included.map((line, index) => ({
    lineId: line.lineId,
    payeeId: line.payeeId,
    amountMinor: line.amount.minor,
    senderItemId: senderItemId(batchId, line.lineId),
    receiverActual: remapReceiver({
      email: line.destination.value,
      payeeId: line.payeeId,
      index,
      pool,
      remapOff,
      live,
    }),
    note: line.note,
    currency: line.amount.currency,
  }));

  const requestBody = { senderBatchId: batchId, itemCount: items.length };

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.payoutRun.updateMany({
        where: { id: runId, status: "APPROVED", currentPlanHash: args.planHash },
        data: { status: "APPLYING", rowVersion: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new Error("CAS_LOST");
      await tx.appliedPlan.create({ data: { planHash: args.planHash, runId } });
      await tx.applyAttempt.create({
        data: {
          runId,
          planHash: args.planHash,
          senderBatchId: batchId,
          requestBody,
          status: "PREPARED",
        },
      });
      await tx.payoutItem.createMany({
        data: items.map((item) => ({
          runId,
          lineId: item.lineId,
          senderItemId: item.senderItemId,
          status: "PENDING",
          payeeId: item.payeeId,
          amountMinor: item.amountMinor,
          receiverActual: item.receiverActual,
        })),
      });
      await appendAudit(tx, {
        actorId: actor.id,
        type: "APPLY_PREPARED",
        runId,
        data: { planHash: args.planHash, senderBatchId: batchId, items: items.length },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "CAS_LOST") {
      const again = await prisma.applyAttempt.findUnique({ where: { runId } });
      const now = await prisma.payoutRun.findUnique({ where: { id: runId } });
      return {
        ok: true,
        data: {
          status: now?.status ?? "APPLYING",
          attemptStatus: again?.status ?? "UNKNOWN",
          paypalBatchId: again?.paypalBatchId ?? null,
          senderBatchId: again?.senderBatchId ?? batchId,
          alreadyApplied: true,
          message: "Already applied. No second payout was sent.",
        },
      };
    }
    if (message.includes("Unique constraint") || message.includes("P2002")) {
      return { ok: false, code: "ALREADY_APPLIED_PLAN", message: "This plan content was already applied by another run." };
    }
    throw err;
  }

  return submitPrepared(runId, args.planHash, batchId, paypal, items);
}

async function submitPrepared(
  runId: string,
  hash: string,
  batchId: string,
  paypal: PayPalClient,
  knownItems?: Array<{
    senderItemId: string;
    receiverActual: string;
    amountMinor: number;
    currency: Currency;
    note: string;
  }>,
) {
  const rows =
    knownItems ??
    (await prisma.payoutItem.findMany({ where: { runId } })).map((row) => ({
      senderItemId: row.senderItemId,
      receiverActual: row.receiverActual,
      amountMinor: row.amountMinor,
      currency: "USD" as const,
      note: "",
    }));

  const result = await paypal.createPayout({
    senderBatchId: batchId,
    items: rows.map((row) => ({
      senderItemId: row.senderItemId,
      receiver: row.receiverActual,
      amount: { minor: row.amountMinor, currency: row.currency },
      note: row.note,
    })),
  });

  if (result.httpStatus >= 200 && result.httpStatus < 300) {
    await prisma.applyAttempt.update({
      where: { runId },
      data: { status: "SUBMITTED", paypalBatchId: result.paypalBatchId, httpStatus: result.httpStatus },
    });
    return {
      ok: true as const,
      data: {
        status: "APPLYING",
        attemptStatus: "SUBMITTED",
        paypalBatchId: result.paypalBatchId,
        senderBatchId: batchId,
        alreadyApplied: false,
        message: result.paypalBatchId
          ? `Submitted. PayPal batch ${result.paypalBatchId}`
          : "Submitted to PayPal.",
      },
    };
  }

  if (result.duplicate) {
    await prisma.applyAttempt.update({
      where: { runId },
      data: {
        status: result.paypalBatchId ? "SUBMITTED" : "UNCERTAIN",
        paypalBatchId: result.paypalBatchId,
        httpStatus: result.httpStatus,
        error: result.raw as object,
      },
    });
    return {
      ok: true as const,
      data: {
        status: "APPLYING",
        attemptStatus: result.paypalBatchId ? "SUBMITTED" : "UNCERTAIN",
        paypalBatchId: result.paypalBatchId,
        senderBatchId: batchId,
        alreadyApplied: true,
        message: result.paypalBatchId
          ? `Already applied: batch id ${result.paypalBatchId}`
          : "PayPal already has this batch id. Left as uncertain — not resent under a new id.",
      },
    };
  }

  if (result.retryable) {
    await prisma.applyAttempt.update({
      where: { runId },
      data: { status: "UNCERTAIN", httpStatus: result.httpStatus || null, error: result.raw as object },
    });
    return {
      ok: true as const,
      data: {
        status: "APPLYING",
        attemptStatus: "UNCERTAIN",
        paypalBatchId: null,
        senderBatchId: batchId,
        alreadyApplied: false,
        message: "PayPal did not answer clearly. The run stays applying; retry uses the same batch id.",
      },
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.applyAttempt.update({
      where: { runId },
      data: { status: "REJECTED_BY_PAYPAL", httpStatus: result.httpStatus, error: result.raw as object },
    });
    await tx.appliedPlan.deleteMany({ where: { runId } });
    await tx.payoutRun.update({
      where: { id: runId },
      data: { status: "FAILED", lastError: { httpStatus: result.httpStatus } },
    });
    await appendAudit(tx, { actorId: "system", type: "APPLY_REJECTED", runId, data: { planHash: hash } });
  });
  return {
    ok: false as const,
    code: "PAYPAL_REJECTED",
    message: "PayPal rejected the payout. Nothing was sent; start a new run to fix the data.",
  };
}
