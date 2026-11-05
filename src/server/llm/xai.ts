import { createChatJsonProvider, type ChatJsonOptions } from "./chat-json";
import type { LlmProvider } from "./provider";

const XAI_URL = "https://api.x.ai/v1/chat/completions";

export type XaiOptions = Omit<ChatJsonOptions, "url" | "label" | "extraBody"> & {
  /** Grok 4.6+ : none | low | medium | high | xhigh. Default xhigh (extra-high, fast). */
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
};

/** Advisory LLM via the xAI API (OpenAI-compatible chat completions). */
export function createXaiProvider(options: XaiOptions): LlmProvider {
  return createChatJsonProvider({
    ...options,
    url: XAI_URL,
    label: "xAI",
    extraBody: {
      reasoning_effort: options.reasoningEffort ?? "xhigh",
    },
  });
}
