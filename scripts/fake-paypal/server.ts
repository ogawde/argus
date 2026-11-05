import { createServer, type Server } from "node:http";

export type FakeMode =
  | "success"
  | "duplicate"
  | "validation"
  | "server_error"
  | "timeout"
  | "unclaimed";

/**
 * Tiny PayPal stand-in. Mode is read from header `x-fake-mode` (default success).
 * Counts POSTs to /v1/payments/payouts so tests can assert "exactly one".
 */
export function startFakePayPal(): Promise<{ server: Server; url: string; posts: () => number }> {
  let posts = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");

    if (req.url?.startsWith("/v1/oauth2/token")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600, token_type: "Bearer" }));
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/v1/payments/payouts")) {
      posts += 1;
      const mode = String(req.headers["x-fake-mode"] ?? "success") as FakeMode;
      if (mode === "timeout") {
        await new Promise((r) => setTimeout(r, 5_000));
      }
      if (mode === "server_error") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "INTERNAL_SERVER_ERROR" }));
        return;
      }
      if (mode === "validation") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "VALIDATION_ERROR", message: "invalid amount" }));
        return;
      }
      if (mode === "duplicate") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: "USER_BUSINESS_ERROR",
            details: [
              {
                field: "SENDER_BATCH_ID",
                issue: "Batch with given sender_batch_id already exists",
                link: [{ href: "https://api.sandbox.paypal.com/v1/payments/payouts/FAKEBATCH1", rel: "self" }],
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          batch_header: { payout_batch_id: "FAKEBATCH1", batch_status: "PENDING" },
          mode,
          echo: raw.slice(0, 80),
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end("no");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, posts: () => posts });
    });
  });
}
