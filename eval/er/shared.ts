import { readFileSync } from "node:fs";
import path from "node:path";
import { buildErFeatures, type ErFeatures, type ErIdentity } from "../../src/domain/er";
import { identityText, normalizeEmail, normalizeName } from "../../src/domain/normalize";
import { dot } from "../../src/server/embeddings/provider";
import { LocalMiniLmProvider } from "../../src/server/embeddings/local-minilm";

export interface LabeledPair {
  id: string;
  label: "match" | "nonmatch";
  category: string;
  a: ErIdentity;
  b: ErIdentity;
}

export interface PairWithFeatures extends LabeledPair {
  features: ErFeatures;
}

export function loadLabeledPairs(): LabeledPair[] {
  const file = path.join(process.cwd(), "eval", "er", "labeled-pairs.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { pairs: LabeledPair[] };
  return parsed.pairs;
}

/** Same text we index in Elasticsearch: "name | email-local | country". */
export function identityTextFor(identity: ErIdentity): string {
  return identityText({
    nameNormalized: normalizeName(identity.name).normalized,
    emailLocalNormalized: normalizeEmail(identity.email).local,
    country: identity.country ?? null,
  });
}

/** Embed both sides of every pair with the real MiniLM model, then build the feature vectors. */
export async function computePairFeatures(pairs: LabeledPair[]): Promise<PairWithFeatures[]> {
  const provider = new LocalMiniLmProvider();
  const texts = pairs.flatMap((pair) => [identityTextFor(pair.a), identityTextFor(pair.b)]);
  const vectors = await provider.embed(texts);

  return pairs.map((pair, index) => {
    const vecCos = dot(vectors[index * 2]!, vectors[index * 2 + 1]!);
    return { ...pair, features: buildErFeatures(pair.a, pair.b, { vecCos }) };
  });
}
