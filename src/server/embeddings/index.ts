import { getEnv } from "@/lib/env";
import { LocalMiniLmProvider } from "./local-minilm";
import type { EmbeddingProvider } from "./provider";

export type { EmbeddingProvider } from "./provider";
export { dot, l2Normalize } from "./provider";

let provider: LocalMiniLmProvider | null = null;

/** One shared provider per server process (the model is big, load it once). */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;

  const env = getEnv();
  // only "local" exists today; the env schema already rejects anything else
  provider = new LocalMiniLmProvider();

  // fail fast: the Elasticsearch mapping and the model must agree
  if (provider.dims !== env.EMBEDDING_MODEL_DIMS) {
    const message = `EMBEDDING_MODEL_DIMS=${env.EMBEDDING_MODEL_DIMS} but ${provider.id} produces ${provider.dims}`;
    provider = null;
    throw new Error(message);
  }
  return provider;
}

export interface WarmUpResult {
  ok: boolean;
  providerId?: string;
  dims?: number;
  ms: number;
  error?: string;
}

/** Call at server boot (or from /api/health) so the first planning run does not pay the model load. */
export async function warmUpEmbeddings(): Promise<WarmUpResult> {
  const started = Date.now();
  try {
    const active = getEmbeddingProvider();
    const [vector] = await active.embed(["argus warm up"]);
    return {
      ok: vector?.length === active.dims,
      providerId: active.id,
      dims: active.dims,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Test helper. */
export function resetEmbeddingProvider(): void {
  provider = null;
}
