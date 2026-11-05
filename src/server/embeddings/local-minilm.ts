import { l2Normalize, type EmbeddingProvider } from "./provider";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const DIMS = 384;
const BATCH_SIZE = 32;
const MAX_CACHED_TEXTS = 5000;

/** The tiny part of the Transformers.js pipeline we use. */
type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

/**
 * Local sentence embeddings with Transformers.js (all-MiniLM-L6-v2, 384 dims).
 * - the model loads once, on first use (or from warmUp())
 * - texts are embedded in batches
 * - results are cached in memory by text, so repeated names cost nothing
 */
export class LocalMiniLmProvider implements EmbeddingProvider {
  id = "local-minilm-384";
  dims = DIMS;

  private extractorPromise: Promise<FeatureExtractor> | null = null;
  private cache = new Map<string, number[]>();

  private loadExtractor(): Promise<FeatureExtractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        // optional: point at a pre-warmed model folder (Docker / Render)
        if (process.env.TRANSFORMERS_CACHE_DIR) {
          env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR;
        }
        const extractor = await pipeline("feature-extraction", MODEL_NAME);
        return extractor as unknown as FeatureExtractor;
      })();
      // if loading fails, allow a retry next time
      this.extractorPromise.catch(() => {
        this.extractorPromise = null;
      });
    }
    return this.extractorPromise;
  }

  /** Load the model and run one tiny embedding so the first real request is fast. */
  async warmUp(): Promise<void> {
    await this.embed(["argus warm up"]);
  }

  async embed(texts: string[]): Promise<number[][]> {
    // find texts we have not seen yet (and de-duplicate them)
    const missing = [...new Set(texts.filter((text) => !this.cache.has(text)))];
    const fresh = new Map<string, number[]>();

    if (missing.length > 0) {
      const extractor = await this.loadExtractor();
      for (let start = 0; start < missing.length; start += BATCH_SIZE) {
        const batch = missing.slice(start, start + BATCH_SIZE);
        const output = await extractor(batch, { pooling: "mean", normalize: true });
        batch.forEach((text, index) => {
          const row = Array.from(output.data.slice(index * DIMS, (index + 1) * DIMS));
          const vector = l2Normalize(row);
          fresh.set(text, vector);
          this.remember(text, vector);
        });
      }
    }

    return texts.map((text) => fresh.get(text) ?? this.cache.get(text)!);
  }

  private remember(text: string, vector: number[]): void {
    // very simple eviction: forget the oldest entry
    if (this.cache.size >= MAX_CACHED_TEXTS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(text, vector);
  }
}
