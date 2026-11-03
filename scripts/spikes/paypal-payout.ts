/**
 * Spike S1 — PayPal Payouts (sandbox).
 * Requires PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / SANDBOX_RECEIVER_POOL in .env.local
 *
 * Observes: OAuth, batch create, duplicate sender_batch_id, non-sandbox receiver,
 * multi-item same receiver, status progression.
 */
import { loadEnvFiles } from "../load-env";

loadEnvFiles();

async function getToken(base: string, clientId: string, secret: string) {
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${await res.text()}`);
  return (await res.json()) as { access_token: string };
}

async function createPayout(
  base: string,
  token: string,
  body: unknown,
  requestId?: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(`${base}/v1/payments/payouts`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text, headers: Object.fromEntries(res.headers) };
}

async function getPayout(base: string, token: string, payoutBatchId: string) {
  const res = await fetch(`${base}/v1/payments/payouts/${payoutBatchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.text() };
}

async function main() {
  const base = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const secret = process.env.PAYPAL_CLIENT_SECRET ?? "";
  const pool = (process.env.SANDBOX_RECEIVER_POOL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!clientId || !secret) {
    console.error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env.local");
    console.error("Fill them in, then re-run: pnpm spike:paypal");
    process.exit(2);
  }
  if (pool.length < 2) {
    console.error("SANDBOX_RECEIVER_POOL needs at least 2 personal sandbox emails");
    process.exit(2);
  }

  const { access_token } = await getToken(base, clientId, secret);
  console.log("OAuth OK");

  const senderBatchId = `ar_spike_${Date.now().toString(36)}`;
  const body = {
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      email_subject: "Argus spike payout",
      email_message: "You have a payout from Argus spike.",
    },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { value: "1.00", currency: "USD" },
        receiver: pool[0],
        sender_item_id: `${senderBatchId}_1`,
        note: "item 1",
      },
      {
        recipient_type: "EMAIL",
        amount: { value: "1.00", currency: "USD" },
        receiver: pool[0], // same receiver twice
        sender_item_id: `${senderBatchId}_2`,
        note: "item 2 same receiver",
      },
      {
        recipient_type: "EMAIL",
        amount: { value: "1.00", currency: "USD" },
        receiver: pool[1],
        sender_item_id: `${senderBatchId}_3`,
        note: "item 3",
      },
    ],
  };

  console.log("\n--- create batch ---");
  const created = await createPayout(base, access_token, body, senderBatchId);
  console.log(created.status, created.body.slice(0, 800));

  let paypalBatchId = "";
  try {
    const parsed = JSON.parse(created.body) as {
      batch_header?: { payout_batch_id?: string };
    };
    paypalBatchId = parsed.batch_header?.payout_batch_id ?? "";
  } catch {
    /* ignore */
  }

  console.log("\n--- duplicate same sender_batch_id WITH PayPal-Request-Id ---");
  const dup1 = await createPayout(base, access_token, body, senderBatchId);
  console.log(dup1.status, dup1.body.slice(0, 800));

  console.log("\n--- duplicate same sender_batch_id WITHOUT PayPal-Request-Id ---");
  const dup2 = await createPayout(base, access_token, body);
  console.log(dup2.status, dup2.body.slice(0, 800));

  console.log("\n--- non-sandbox email item ---");
  const unclaimedBody = {
    sender_batch_header: {
      sender_batch_id: `ar_spike_u_${Date.now().toString(36)}`,
      email_subject: "Argus unclaimed spike",
    },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { value: "1.00", currency: "USD" },
        receiver: "argus-unclaimed-not-a-sandbox@example.com",
        sender_item_id: `u_${Date.now()}`,
        note: "unclaimed probe",
      },
    ],
  };
  const unclaimed = await createPayout(
    base,
    access_token,
    unclaimedBody,
    unclaimedBody.sender_batch_header.sender_batch_id,
  );
  console.log(unclaimed.status, unclaimed.body.slice(0, 800));

  if (paypalBatchId) {
    console.log("\n--- poll batch status ---");
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await getPayout(base, access_token, paypalBatchId);
      console.log(`t+${(i + 1) * 2}s`, status.status, status.body.slice(0, 600));
    }
  }

  console.log("\nRecord findings in docs/NOTES/paypal.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
