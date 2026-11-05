import { toDecimalString, type Money } from "@/domain/money";

export interface PayoutItemRequest {
  senderItemId: string;
  receiver: string;
  amount: Money;
  note: string;
}

export interface CreatePayoutResult {
  httpStatus: number;
  paypalBatchId: string | null;
  raw: unknown;
  /** 400 "sender_batch_id already exists" — do not mint a new id. */
  duplicate: boolean;
  retryable: boolean;
}

export interface PayPalClient {
  createPayout(args: {
    senderBatchId: string;
    items: PayoutItemRequest[];
  }): Promise<CreatePayoutResult>;
  getPayout(paypalBatchId: string): Promise<{ httpStatus: number; raw: unknown }>;
}

interface ClientOpts {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isDuplicate(status: number, body: unknown): boolean {
  if (status !== 400 || !body || typeof body !== "object") return false;
  const text = JSON.stringify(body);
  return text.includes("already exists") || text.includes("SENDER_BATCH_ID");
}

function batchIdFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as {
    batch_header?: { payout_batch_id?: string };
    links?: Array<{ href?: string }>;
    details?: Array<{ link?: Array<{ href?: string }> }>;
  };
  if (o.batch_header?.payout_batch_id) return o.batch_header.payout_batch_id;
  const hrefs = [
    ...(o.links ?? []).map((l) => l.href),
    ...(o.details ?? []).flatMap((d) => (d.link ?? []).map((l) => l.href)),
  ].filter(Boolean) as string[];
  for (const href of hrefs) {
    const m = href.match(/\/payouts\/([A-Z0-9]+)/i);
    if (m) return m[1]!;
  }
  return null;
}

export function createPayPalClient(opts: ClientOpts): PayPalClient {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 3;
  const doFetch = opts.fetchImpl ?? fetch;
  let token: { value: string; exp: number } | null = null;

  async function getToken(): Promise<string> {
    if (token && token.exp > Date.now() + 5_000) return token.value;
    const res = await doFetch(`${opts.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`paypal oauth ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    token = { value: json.access_token, exp: Date.now() + (json.expires_in ?? 300) * 1000 };
    return token.value;
  }

  return {
    async createPayout({ senderBatchId, items }) {
      const body = {
        sender_batch_header: {
          sender_batch_id: senderBatchId,
          email_subject: "Argus payout",
          email_message: "You have a payout from Argus.",
        },
        items: items.map((item) => ({
          recipient_type: "EMAIL",
          amount: { value: toDecimalString(item.amount), currency: item.amount.currency },
          receiver: item.receiver,
          sender_item_id: item.senderItemId,
          note: item.note.slice(0, 200),
        })),
      };

      let last: CreatePayoutResult = {
        httpStatus: 0,
        paypalBatchId: null,
        raw: null,
        duplicate: false,
        retryable: true,
      };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const access = await getToken();
          const headers: Record<string, string> = {
            Authorization: `Bearer ${access}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": senderBatchId,
          };
          if (process.env.FAKE_PAYPAL_MODE) headers["x-fake-mode"] = process.env.FAKE_PAYPAL_MODE;
          const res = await doFetch(`${opts.baseUrl}/v1/payments/payouts`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const text = await res.text();
          let parsed: unknown = text;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            /* keep text */
          }
          const retryable = res.status >= 500 || res.status === 429;
          last = {
            httpStatus: res.status,
            paypalBatchId: batchIdFrom(parsed),
            raw: parsed,
            duplicate: isDuplicate(res.status, parsed),
            retryable,
          };
          if (!retryable) return last;
        } catch (err) {
          last = {
            httpStatus: 0,
            paypalBatchId: null,
            raw: { error: err instanceof Error ? err.name : "network" },
            duplicate: false,
            retryable: true,
          };
        }
        if (attempt < maxRetries) await sleep(50 * 2 ** attempt);
      }
      return last;
    },

    async getPayout(paypalBatchId) {
      const access = await getToken();
      const res = await doFetch(`${opts.baseUrl}/v1/payments/payouts/${paypalBatchId}`, {
        headers: { Authorization: `Bearer ${access}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let raw: unknown = text;
      try {
        raw = text ? JSON.parse(text) : null;
      } catch {
        /* keep text */
      }
      return { httpStatus: res.status, raw };
    },
  };
}
