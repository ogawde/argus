import type { Client } from "@elastic/elasticsearch";
import { getEnv } from "@/lib/env";
import type { EmbeddingProvider } from "../embeddings/provider";
import { getElasticClient } from "./client";

/** Must match `dense_vector.dims` in the identities mapping (ARCHITECTURE §10.1). */
export const EMBEDDING_DIMS = 384;

/** Fail fast if the embedding provider cannot feed the mapping. */
export function assertEmbeddingDims(provider: EmbeddingProvider): void {
  if (provider.dims !== EMBEDDING_DIMS) {
    throw new Error(
      `Embedding provider "${provider.id}" has dims=${provider.dims}, but the index mapping needs ${EMBEDDING_DIMS}`,
    );
  }
}

/** Aliases the app queries. Physical index = `<alias>-<ES_INDEX_VERSION>`. */
export const HISTORY_ALIAS = "payout-history";
export const IDENTITIES_ALIAS = "payee-identities";

export function historyIndexName(version = getEnv().ES_INDEX_VERSION): string {
  return `${HISTORY_ALIAS}-${version}`;
}

export function identitiesIndexName(version = getEnv().ES_INDEX_VERSION): string {
  return `${IDENTITIES_ALIAS}-${version}`;
}

// ARCHITECTURE §10.1
const historyMappings = {
  properties: {
    payee_id: { type: "keyword" },
    destination_fingerprint: { type: "keyword" },
    amount_minor: { type: "long" },
    currency: { type: "keyword" },
    paid_at: { type: "date" },
    batch_ref: { type: "keyword" },
  },
} as const;

const identitiesMappings = {
  properties: {
    payee_id: { type: "keyword" },
    name_raw: { type: "text" },
    name_normalized: { type: "text", fields: { keyword: { type: "keyword" } } },
    email_normalized: { type: "keyword" },
    email_local_normalized: { type: "text", fields: { keyword: { type: "keyword" } } },
    destination_fingerprint: { type: "keyword" },
    country: { type: "keyword" },
    created_at: { type: "date" },
    identity_text: { type: "text" },
    embedding: {
      type: "dense_vector",
      dims: EMBEDDING_DIMS,
      index: true,
      similarity: "cosine",
    },
  },
} as const;

async function ensureIndex(
  es: Client,
  index: string,
  alias: string,
  mappings: typeof historyMappings | typeof identitiesMappings,
): Promise<"created" | "exists"> {
  const exists = await es.indices.exists({ index });
  if (!exists) {
    await es.indices.create({ index, mappings });
  }
  // putAlias is a no-op when the alias already points here
  await es.indices.putAlias({ index, name: alias });
  return exists ? "exists" : "created";
}

/** Existing identities index must already use 384-dim vectors. */
async function assertExistingDims(es: Client, index: string): Promise<void> {
  const res = await es.indices.getMapping({ index });
  const props = res[index]?.mappings?.properties as
    | Record<string, { dims?: number }>
    | undefined;
  const dims = props?.embedding?.dims;
  if (dims !== EMBEDDING_DIMS) {
    throw new Error(
      `Index ${index} embedding dims=${String(dims)}, expected ${EMBEDDING_DIMS}. Recreate the index.`,
    );
  }
}

/**
 * Create both indices + aliases if missing. Safe to call on every boot / seed.
 * Fails fast if the embedding provider is not 384 dims.
 */
export async function setupElasticIndices(provider: EmbeddingProvider): Promise<{
  history: "created" | "exists";
  identities: "created" | "exists";
}> {
  assertEmbeddingDims(provider);

  const es = getElasticClient();
  const history = await ensureIndex(es, historyIndexName(), HISTORY_ALIAS, historyMappings);
  const identities = await ensureIndex(
    es,
    identitiesIndexName(),
    IDENTITIES_ALIAS,
    identitiesMappings,
  );
  await assertExistingDims(es, identitiesIndexName());

  return { history, identities };
}
