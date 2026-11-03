/**
 * Spike S2 — Elasticsearch ES|QL + kNN + embeddings.
 */
import { loadEnvFiles } from "../load-env";

loadEnvFiles();

async function main() {
  const { Client } = await import("@elastic/elasticsearch");
  const url = process.env.ELASTICSEARCH_URL ?? "http://localhost:9200";
  const client = new Client({ node: url });

  const info = await client.info();
  console.log("ES version:", info.version.number);

  const history = "payout-history-v1";
  const identities = "payee-identities-v1";

  await client.indices.delete({ index: history }, { ignore: [404] });
  await client.indices.delete({ index: identities }, { ignore: [404] });

  await client.indices.create({
    index: history,
    mappings: {
      properties: {
        payee_id: { type: "keyword" },
        destination_fingerprint: { type: "keyword" },
        amount_minor: { type: "long" },
        currency: { type: "keyword" },
        paid_at: { type: "date" },
        batch_ref: { type: "keyword" },
      },
    },
  });

  await client.indices.create({
    index: identities,
    mappings: {
      properties: {
        payee_id: { type: "keyword" },
        name_raw: { type: "text" },
        name_normalized: {
          type: "text",
          fields: { keyword: { type: "keyword" } },
        },
        email_normalized: { type: "keyword" },
        email_local_normalized: {
          type: "text",
          fields: { keyword: { type: "keyword" } },
        },
        destination_fingerprint: { type: "keyword" },
        country: { type: "keyword" },
        created_at: { type: "date" },
        identity_text: { type: "text" },
        embedding: {
          type: "dense_vector",
          dims: 384,
          index: true,
          similarity: "cosine",
        },
      },
    },
  });

  // aliases
  await client.indices.putAlias({ index: history, name: "payout-history" });
  await client.indices.putAlias({ index: identities, name: "payee-identities" });

  const historyDocs = [];
  for (let i = 0; i < 1000; i++) {
    const payee = `P-${String((i % 50) + 1).padStart(4, "0")}`;
    historyDocs.push({
      payee_id: payee,
      destination_fingerprint: `fp-${payee}`,
      amount_minor: 1000 + (i % 40) * 25,
      currency: "USD",
      paid_at: new Date(Date.UTC(2025, i % 12, 1 + (i % 27))).toISOString(),
      batch_ref: `B-${Math.floor(i / 50)}`,
    });
  }

  const ops = historyDocs.flatMap((doc) => [{ index: { _index: history } }, doc]);
  await client.bulk({ refresh: true, operations: ops });
  console.log("indexed history:", historyDocs.length);

  console.log("\n--- loading embedding model ---");
  const t0 = Date.now();
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  console.log("model load ms:", Date.now() - t0);

  async function embed(text: string): Promise<number[]> {
    const out = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(out.data as Float32Array);
  }

  const names = [
    { id: "P-0118", name: "John Doe", email: "john.doe@example.com" },
    { id: "P-NEW", name: "Jon Doe", email: "jon.doe.pay@example.com" },
    { id: "P-0099", name: "Jane Doe", email: "jane.doe@example.com" },
  ];

  const identityOps = [];
  for (const n of names) {
    const identityText = `${n.name.toLowerCase()} | ${n.email.split("@")[0]} | US`;
    const t1 = Date.now();
    const vector = await embed(identityText);
    console.log(`embed "${n.name}" ms:`, Date.now() - t1, "dims:", vector.length);
    identityOps.push(
      { index: { _index: identities } },
      {
        payee_id: n.id,
        name_raw: n.name,
        name_normalized: n.name.toLowerCase(),
        email_normalized: n.email.toLowerCase(),
        email_local_normalized: n.email.split("@")[0].toLowerCase(),
        destination_fingerprint: `fp-${n.id}`,
        country: "US",
        created_at: new Date().toISOString(),
        identity_text: identityText,
        embedding: vector,
      },
    );
  }
  // pad with more synthetic identities
  for (let i = 0; i < 47; i++) {
    const name = `Payee ${i}`;
    const email = `payee${i}@example.com`;
    const identityText = `${name.toLowerCase()} | payee${i} | US`;
    const vector = await embed(identityText);
    identityOps.push(
      { index: { _index: identities } },
      {
        payee_id: `P-S${i}`,
        name_raw: name,
        name_normalized: name.toLowerCase(),
        email_normalized: email,
        email_local_normalized: `payee${i}`,
        destination_fingerprint: `fp-S${i}`,
        country: "US",
        created_at: new Date().toISOString(),
        identity_text: identityText,
        embedding: vector,
      },
    );
  }
  await client.bulk({ refresh: true, operations: identityOps });
  console.log("indexed identities");

  // ES|QL probes — syntax may need adjustment for pinned version
  const queries: { name: string; query: string }[] = [
    {
      name: "Q1 baseline",
      query: `FROM payout-history
| WHERE payee_id == "P-0001"
| STATS n = COUNT(*), last_paid = MAX(paid_at)`,
    },
    {
      name: "Q3 burst",
      query: `FROM payout-history
| WHERE paid_at >= "2025-01-01T00:00:00Z"
| STATS recent_n = COUNT(*) BY payee_id
| WHERE recent_n >= 5
| LIMIT 10`,
    },
    {
      name: "Q4 shared destinations",
      query: `FROM payee-identities
| STATS payees = COUNT_DISTINCT(payee_id) BY destination_fingerprint
| WHERE payees > 1
| LIMIT 10`,
    },
  ];

  for (const q of queries) {
    console.log(`\n--- ${q.name} ---`);
    try {
      const res = await client.esql.query({ query: q.query });
      console.log(JSON.stringify(res, null, 2).slice(0, 600));
    } catch (err) {
      console.error("FAILED:", err instanceof Error ? err.message : err);
    }
  }

  console.log("\n--- kNN Jon Doe ---");
  const jonVec = await embed("jon doe | jon.doe.pay | US");
  const knn = await client.search({
    index: identities,
    knn: {
      field: "embedding",
      query_vector: jonVec,
      k: 5,
      num_candidates: 50,
    },
  });
  for (const hit of knn.hits.hits) {
    const src = hit._source as { payee_id: string; name_raw: string };
    console.log(hit._score, src.payee_id, src.name_raw);
  }

  const mem = process.memoryUsage();
  console.log("\nRSS MB:", Math.round(mem.rss / 1024 / 1024));
  console.log("Record findings in docs/NOTES/elastic.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
