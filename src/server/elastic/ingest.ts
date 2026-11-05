import { identityText, normalizeEmail, normalizeName } from "@/domain/normalize";
import type { EmbeddingProvider } from "../embeddings/provider";
import { getElasticClient } from "./client";
import {
  EMBEDDING_DIMS,
  HISTORY_ALIAS,
  IDENTITIES_ALIAS,
  assertEmbeddingDims,
  historyIndexName,
  identitiesIndexName,
  setupElasticIndices,
} from "./indices";

/** Works with Prisma rows and with the seed dataset. */
export interface IngestPayee {
  id: string;
  displayName: string;
  country: string | null;
  destinationValue: string;
  destinationFingerprint: string;
  createdAt: Date;
}

export interface IngestHistory {
  id: string;
  payeeId: string;
  destinationFingerprint: string;
  amountMinor: number;
  currency: string;
  paidAt: Date;
  batchRef: string;
}

const BULK_CHUNK = 500;
const EMBED_CHUNK = 64;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function bulkIndex(index: string, docs: Array<{ id: string; body: object }>): Promise<void> {
  const es = getElasticClient();
  for (const part of chunk(docs, BULK_CHUNK)) {
    const operations = part.flatMap((d) => [{ index: { _index: index, _id: d.id } }, d.body]);
    const res = await es.bulk({ operations, refresh: false });
    if (res.errors) {
      const firstError = res.items.find((i) => i.index?.error)?.index?.error;
      throw new Error(`Bulk index into ${index} failed: ${JSON.stringify(firstError)}`);
    }
  }
}

/** Remove every doc so the re-index leaves exactly what Postgres has. */
async function clearIndex(index: string): Promise<void> {
  const es = getElasticClient();
  await es.deleteByQuery({
    index,
    query: { match_all: {} },
    refresh: true,
    conflicts: "proceed",
  });
}

export async function ingestHistory(history: IngestHistory[]): Promise<number> {
  const index = historyIndexName();
  await clearIndex(index);
  await bulkIndex(
    index,
    history.map((h) => ({
      id: h.id,
      body: {
        payee_id: h.payeeId,
        destination_fingerprint: h.destinationFingerprint,
        amount_minor: h.amountMinor,
        currency: h.currency,
        paid_at: h.paidAt.toISOString(),
        batch_ref: h.batchRef,
      },
    })),
  );
  await getElasticClient().indices.refresh({ index });
  return history.length;
}

export async function ingestIdentities(
  payees: IngestPayee[],
  provider: EmbeddingProvider,
): Promise<number> {
  assertEmbeddingDims(provider);
  const index = identitiesIndexName();

  const prepared = payees.map((p) => {
    const name = normalizeName(p.displayName);
    const email = normalizeEmail(p.destinationValue);
    return {
      payee: p,
      name,
      email,
      text: identityText({
        nameNormalized: name.normalized,
        emailLocalNormalized: email.local,
        country: p.country,
      }),
    };
  });

  // embed first, so a model failure doesn't leave the index half-empty
  const vectors: number[][] = [];
  for (const part of chunk(prepared, EMBED_CHUNK)) {
    const out = await provider.embed(part.map((p) => p.text));
    vectors.push(...out);
  }
  if (vectors.length !== prepared.length) {
    throw new Error(`Embedding count mismatch: got ${vectors.length}, wanted ${prepared.length}`);
  }
  if (vectors.some((v) => v.length !== EMBEDDING_DIMS)) {
    throw new Error(`Embedding provider returned vectors that are not ${EMBEDDING_DIMS} dims`);
  }

  await clearIndex(index);
  await bulkIndex(
    index,
    prepared.map((p, i) => ({
      id: p.payee.id,
      body: {
        payee_id: p.payee.id,
        name_raw: p.payee.displayName,
        name_normalized: p.name.normalized,
        email_normalized: p.email.normalized,
        email_local_normalized: p.email.local,
        destination_fingerprint: p.payee.destinationFingerprint,
        country: p.payee.country,
        created_at: p.payee.createdAt.toISOString(),
        identity_text: p.text,
        embedding: vectors[i],
      },
    })),
  );
  await getElasticClient().indices.refresh({ index });
  return prepared.length;
}

export interface IngestResult {
  historyDocs: number;
  identityDocs: number;
  historyCount: number;
  identityCount: number;
}

/**
 * Create indices if needed, then replace all docs with the given rows.
 * Safe to run repeatedly: ids are the Postgres ids and old docs are deleted first.
 */
export async function reindexElastic(args: {
  payees: IngestPayee[];
  history: IngestHistory[];
  provider: EmbeddingProvider;
}): Promise<IngestResult> {
  await setupElasticIndices(args.provider);

  const historyDocs = await ingestHistory(args.history);
  const identityDocs = await ingestIdentities(args.payees, args.provider);

  // count through the aliases to prove they resolve
  const es = getElasticClient();
  const [historyCount, identityCount] = await Promise.all([
    es.count({ index: HISTORY_ALIAS }),
    es.count({ index: IDENTITIES_ALIAS }),
  ]);

  return {
    historyDocs,
    identityDocs,
    historyCount: historyCount.count,
    identityCount: identityCount.count,
  };
}
