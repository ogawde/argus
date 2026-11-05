import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ingestWebhook } from "@/server/paypal/ingest-webhook";
import { webhookAuthorized } from "@/server/paypal/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PayPal payout webhook. `PAYPAL_WEBHOOK_VERIFY=off` is allowed only outside production.
 * Strict mode checks the transmission headers are present; full cert crypto is PayPal's verify API.
 */
export async function POST(req: Request) {
  const env = getEnv();
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const allowed = webhookAuthorized({
    verify: env.PAYPAL_WEBHOOK_VERIFY,
    nodeEnv: env.NODE_ENV,
    webhookId: env.PAYPAL_WEBHOOK_ID,
    transmissionId: req.headers.get("paypal-transmission-id"),
    transmissionSig: req.headers.get("paypal-transmission-sig"),
    transmissionTime: req.headers.get("paypal-transmission-time"),
  });
  if (!allowed) return Response.json({ ok: false, error: "webhook signature rejected" }, { status: 401 });
  if (env.PAYPAL_WEBHOOK_VERIFY === "off") {
    logger.warn("PayPal webhook accepted without signature verification");
  }

  const result = await ingestWebhook(body, env.PAYPAL_WEBHOOK_VERIFY !== "off");
  return Response.json({ ok: result.httpStatus === 200, duplicate: result.duplicate }, { status: result.httpStatus });
}
