/**
 * Tiny webhook catcher for PayPal spike.
 * Point ngrok at this port, register the URL in the PayPal app, then run payouts.
 * Samples land in docs/NOTES/webhook-samples/ (Authorization header redacted).
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.WEBHOOK_SPIKE_PORT ?? 3456);
const outDir = path.join(process.cwd(), "docs/NOTES/webhook-samples");
mkdirSync(outDir, { recursive: true });

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");

  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  delete headers.authorization;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(outDir, `${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify({ receivedAt: new Date().toISOString(), headers, rawBody: raw }, null, 2),
  );
  console.log(`saved ${file}`);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(port, () => {
  console.log(`webhook listener on http://localhost:${port}`);
  console.log(`ngrok: ngrok http --url=<your-static-domain> ${port}`);
  console.log(`PayPal webhook URL: https://<your-static-domain>/  (or path you choose)`);
});
