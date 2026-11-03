import { loadEnvFiles } from "./load-env";

loadEnvFiles();

async function main() {
  const { getEnv, hasPayPalCreds, resetEnvCache } = await import("../src/lib/env");
  resetEnvCache();
  const env = getEnv();
  console.log("✓ env valid");

  const { prisma } = await import("../src/server/db");
  await prisma.$queryRaw`SELECT 1`;
  console.log("✓ postgres reachable");

  const { pingElasticsearch } = await import("../src/server/elastic/client");
  const es = await pingElasticsearch();
  if (!es.ok) throw new Error(`elasticsearch: ${es.error}`);
  console.log(`✓ elasticsearch ${es.version}`);

  if (hasPayPalCreds(env)) {
    const tokenRes = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!tokenRes.ok) {
      throw new Error(`PayPal OAuth failed: ${tokenRes.status} ${await tokenRes.text()}`);
    }
    const json = (await tokenRes.json()) as { token_type?: string; expires_in?: number };
    console.log(`✓ paypal oauth (${json.token_type}, expires_in=${json.expires_in})`);
  } else {
    console.log("⚠ paypal credentials missing — skip OAuth (fill .env.local when ready)");
  }

  console.log("\npreflight OK");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("preflight FAILED:", err);
  process.exit(1);
});
