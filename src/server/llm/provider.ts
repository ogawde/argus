import type { z } from "zod";

/** Any model backend that can answer with JSON matching a Zod schema. */
export interface LlmProvider {
  /** Resolves with a validated object, or throws (timeout, bad JSON, schema mismatch, HTTP error). */
  generateJson<T>(args: {
    schema: z.ZodType<T>;
    system: string;
    user: string;
    maxTokens: number;
    timeoutMs: number;
  }): Promise<T>;
}
