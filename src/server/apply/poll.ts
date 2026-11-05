import { canAdvanceStatus } from "@/domain/reconcile";
import { getEnv, hasPayPalCreds } from "@/lib/env";
import { prisma } from "@/server/db";
import { settleRun } from "@/server/paypal/ingest-webhook";
import { createPayPalClient } from "@/server/paypal/client";

/**
 * Ask PayPal for the batch, then settle the run if every included item is terminal.
 * Safe to call on the RECONCILE_POLL_MS interval. A failed poll leaves the run APPLYING.
 */
export async function pollReconciliation(runId: string): Promise<void> {
  const attempt = await prisma.applyAttempt.findUnique({ where: { runId } });
  if (attempt?.paypalBatchId && hasPayPalCreds()) {
    try {
      const env = getEnv();
      const client = createPayPalClient({
        baseUrl: env.PAYPAL_API_BASE,
        clientId: env.PAYPAL_CLIENT_ID,
        clientSecret: env.PAYPAL_CLIENT_SECRET,
      });
      const batch = await client.getPayout(attempt.paypalBatchId);
      const body = batch.raw as {
        items?: Array<{ transaction_status?: string; payout_item?: { sender_item_id?: string } }>;
      };
      for (const row of body.items ?? []) {
        const sender = row.payout_item?.sender_item_id;
        const next = row.transaction_status;
        if (!sender || !next) continue;
        const item = await prisma.payoutItem.findUnique({ where: { senderItemId: sender } });
        if (!item || !canAdvanceStatus(item.status, next)) continue;
        await prisma.payoutItem.update({
          where: { id: item.id },
          data: { status: next, source: "poll", lastEventAt: new Date() },
        });
      }
    } catch {
      // A failed poll leaves the run APPLYING. The next tick tries again.
    }
  }
  await settleRun(runId);
}
