import { Client } from "@elastic/elasticsearch";
import { getEnv } from "@/lib/env";

let client: Client | null = null;

export function getElasticClient(): Client {
  if (!client) {
    const env = getEnv();
    client = new Client({ node: env.ELASTICSEARCH_URL });
  }
  return client;
}

export async function pingElasticsearch(): Promise<{ ok: true; version?: string } | { ok: false; error: string }> {
  try {
    const es = getElasticClient();
    const info = await es.info();
    return { ok: true, version: info.version.number };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
