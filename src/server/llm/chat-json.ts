import type { z } from "zod";
import type { LlmProvider } from "./provider";

const MAX_RATE_LIMIT_RETRIES = 2;
const BASE_BACKOFF_MS = 1000;

export interface ChatJsonOptions {
  apiKey: string;
  model: string;
  /** Full chat-completions URL */
  url: string;
  /** Shown in error messages, e.g. "xAI" or "OpenRouter" */
  label: string;
  /** Extra JSON body fields (reasoning_effort, etc.) */
  extraBody?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Models sometimes wrap JSON in ```json fences. Take the part between the first { and the last }. */
export function extractJsonText(content: string): string {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return content;
  return content.slice(start, end + 1);
}

/** OpenAI-compatible chat call that must return schema-valid JSON. */
export function createChatJsonProvider(options: ChatJsonOptions): LlmProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  return {
    async generateJson<T>(args: {
      schema: z.ZodType<T>;
      system: string;
      user: string;
      maxTokens: number;
      timeoutMs: number;
    }): Promise<T> {
      let response: Response | null = null;

      for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
        response = await doFetch(options.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: args.maxTokens,
            temperature: 0,
            response_format: { type: "json_object" },
            ...options.extraBody,
            messages: [
              { role: "system", content: args.system },
              { role: "user", content: args.user },
            ],
          }),
          signal: AbortSignal.timeout(args.timeoutMs),
        });
        if (response.status !== 429) break;
        if (attempt < MAX_RATE_LIMIT_RETRIES) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }

      if (!response || !response.ok) {
        throw new Error(`${options.label} ${options.model}: HTTP ${response?.status ?? "none"}`);
      }

      const body = (await response.json()) as ChatResponse;
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${options.label} ${options.model}: empty response`);

      return args.schema.parse(JSON.parse(extractJsonText(content)));
    },
  };
}
