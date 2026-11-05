import type { Client } from "@elastic/elasticsearch";
import { getElasticClient } from "@/server/elastic/client";
import { IDENTITIES_ALIAS } from "@/server/elastic/indices";

/**
 * Candidate retrieval for entity resolution (ARCHITECTURE §11.4).
 * Elasticsearch only finds look-alikes; scoring happens in src/domain/er.ts.
 */

const CANDIDATES_PER_CHANNEL = 20;
const KNN_NUM_CANDIDATES = 100;

export type ErChannel = "vector" | "fuzzyName" | "destination" | "batch";

/** The identity we are looking for look-alikes of. */
export interface IdentityQuery {
  /** own payee id (excluded from results), or null for a brand-new payee */
  payeeId: string | null;
  nameNormalized: string;
  emailLocalNormalized: string;
  destinationFingerprint: string;
  /** L2-normalized embedding of the identity text */
  embedding: number[];
}

export interface ErCandidate {
  payeeId: string;
  nameRaw: string;
  nameNormalized: string;
  emailNormalized: string;
  emailLocalNormalized: string;
  destinationFingerprint: string;
  country: string | null;
  identityText: string;
  /** cosine similarity if the vector channel found it (or we computed it later), else null */
  vectorCos: number | null;
  channels: ErChannel[];
}

/** Shape of one document in payee-identities (ARCHITECTURE §10.1). */
interface IdentityDoc {
  payee_id: string;
  name_raw?: string;
  name_normalized?: string;
  email_normalized?: string;
  email_local_normalized?: string;
  destination_fingerprint?: string;
  country?: string | null;
  identity_text?: string;
}

const SOURCE_FIELDS = [
  "payee_id",
  "name_raw",
  "name_normalized",
  "email_normalized",
  "email_local_normalized",
  "destination_fingerprint",
  "country",
  "identity_text",
];

/** For cosine similarity ES scores a hit as (1 + cos) / 2, so turn it back into cos. */
export function cosineFromEsScore(score: number): number {
  return 2 * score - 1;
}

function excludeOwnPayee(payeeId: string | null) {
  return payeeId ? { bool: { must_not: [{ term: { payee_id: payeeId } }] } } : undefined;
}

/** Run the three searches and union the results (one entry per payee). */
export async function retrieveCandidates(
  query: IdentityQuery,
  es: Client = getElasticClient(),
): Promise<ErCandidate[]> {
  const ownPayeeFilter = excludeOwnPayee(query.payeeId);

  // 1) vector channel: nearest neighbours of the identity embedding
  const vectorSearch = es.search<IdentityDoc>({
    index: IDENTITIES_ALIAS,
    size: CANDIDATES_PER_CHANNEL,
    _source: SOURCE_FIELDS,
    knn: {
      field: "embedding",
      query_vector: query.embedding,
      k: CANDIDATES_PER_CHANNEL,
      num_candidates: KNN_NUM_CANDIDATES,
      ...(ownPayeeFilter ? { filter: ownPayeeFilter } : {}),
    },
  });

  // 2) lexical channel: fuzzy match on the normalized name
  const nameSearch = es.search<IdentityDoc>({
    index: IDENTITIES_ALIAS,
    size: CANDIDATES_PER_CHANNEL,
    _source: SOURCE_FIELDS,
    query: {
      bool: {
        must: [
          {
            match: {
              name_normalized: {
                query: query.nameNormalized,
                fuzziness: "AUTO",
                operator: "and",
              },
            },
          },
        ],
        ...(query.payeeId ? { must_not: [{ term: { payee_id: query.payeeId } }] } : {}),
      },
    },
  });

  // 3) destination / email channel: same inbox, or a very similar email local part
  const destinationShould: object[] = [];
  if (query.destinationFingerprint) {
    destinationShould.push({ term: { destination_fingerprint: query.destinationFingerprint } });
  }
  if (query.emailLocalNormalized) {
    destinationShould.push({
      match: {
        email_local_normalized: { query: query.emailLocalNormalized, fuzziness: "AUTO" },
      },
    });
  }
  const destinationSearch = destinationShould.length
    ? es.search<IdentityDoc>({
        index: IDENTITIES_ALIAS,
        size: CANDIDATES_PER_CHANNEL,
        _source: SOURCE_FIELDS,
        query: {
          bool: {
            should: destinationShould,
            minimum_should_match: 1,
            ...(query.payeeId ? { must_not: [{ term: { payee_id: query.payeeId } }] } : {}),
          },
        },
      })
    : null;

  const [vectorResult, nameResult, destinationResult] = await Promise.all([
    vectorSearch,
    nameSearch,
    destinationSearch,
  ]);

  const byPayee = new Map<string, ErCandidate>();

  function addHits(
    hits: Array<{ _score?: number | null; _source?: IdentityDoc }>,
    channel: ErChannel,
  ): void {
    for (const hit of hits) {
      const doc = hit._source;
      if (!doc?.payee_id) continue;

      const existing = byPayee.get(doc.payee_id);
      const candidate: ErCandidate = existing ?? {
        payeeId: doc.payee_id,
        nameRaw: doc.name_raw ?? "",
        nameNormalized: doc.name_normalized ?? "",
        emailNormalized: doc.email_normalized ?? "",
        emailLocalNormalized: doc.email_local_normalized ?? "",
        destinationFingerprint: doc.destination_fingerprint ?? "",
        country: doc.country ?? null,
        identityText: doc.identity_text ?? "",
        vectorCos: null,
        channels: [],
      };

      if (!candidate.channels.includes(channel)) candidate.channels.push(channel);
      if (channel === "vector" && typeof hit._score === "number") {
        candidate.vectorCos = cosineFromEsScore(hit._score);
      }
      byPayee.set(doc.payee_id, candidate);
    }
  }

  addHits(vectorResult.hits.hits, "vector");
  addHits(nameResult.hits.hits, "fuzzyName");
  if (destinationResult) addHits(destinationResult.hits.hits, "destination");

  return [...byPayee.values()];
}
