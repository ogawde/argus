import { z } from "zod";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createOpenRouterProvider } from "./openrouter";
import type { LlmProvider } from "./provider";
import {
  ASSESSMENTS,
  buildTemplateRationale,
  rationaleCacheKey,
  type EvidenceBundle,
} from "./template";

export type LlmMode = "live" | "cached" | "off";

/** What the model must return (ARCHITECTURE §12). */
export const RationaleOutputSchema = z.object({
  summary: z.string().min(1),
  assessment: z.enum(ASSESSMENTS),
  citedEvidenceKeys: z.array(z.string()),
});

function cutSummary(text: string): string {
  return text.length <= 280 ? text : `${text.slice(0, 279)}…`;
}

/** One rationale as stored in AnalysisCache and shown in the UI. */
export interface StoredRationale {
  summary: string;
  assessment: (typeof ASSESSMENTS)[number];
  citedEvidenceKeys: string[];
  /** model that wrote it, or "template" */
  model: string;
  promptVersion: string;
  generatedAt: string;
  /** true if the model cited evidence keys that were not in the bundle (they were dropped) */
  unverifiedCitations: boolean;
}

export interface Rationale extends StoredRationale {
  /** where this answer came from this time */
  source: "llm" | "cache" | "template";
}

/** Drop the per-call `source` field before saving. */
export function toStoredRationale(rationale: Rationale): StoredRationale {
  return {
    summary: rationale.summary,
    assessment: rationale.assessment,
    citedEvidenceKeys: rationale.citedEvidenceKeys,
    model: rationale.model,
    promptVersion: rationale.promptVersion,
    generatedAt: rationale.generatedAt,
    unverifiedCitations: rationale.unverifiedCitations,
  };
}

/** Tiny storage interface so tests do not need a database. */
export interface RationaleStore {
  get(key: string): Promise<StoredRationale | null>;
  set(key: string, value: StoredRationale): Promise<void>;
}

export interface NamedProvider {
  model: string;
  provider: LlmProvider;
}

export interface RationaleDeps {
  mode: LlmMode;
  promptVersion: string;
  store: RationaleStore;
  /** primary first, then fallbacks */
  models: NamedProvider[];
  timeoutMs?: number;
  maxTokens?: number;
  now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_TOKENS = 400;
const ATTEMPTS_PER_MODEL = 2; // first try + one retry on invalid output
export const LLM_CONCURRENCY = 3;

const SYSTEM_PROMPT = [
  "You are an advisory assistant for a payout reviewer. A deterministic rule engine has already flagged a payout line.",
  "You only explain the evidence you are given. You cannot approve, block, or change anything.",
  "Use only the evidence in the bundle. Do not invent facts, names, or numbers.",
  "Answer with ONE JSON object and nothing else:",
  '{"summary": string (max 280 chars, plain sentences), "assessment": "LIKELY_FRAUD" | "SUSPICIOUS" | "LIKELY_BENIGN" | "INSUFFICIENT", "citedEvidenceKeys": string[]}',
  "citedEvidenceKeys must be keys that appear in the bundle's evidence list.",
].join("\n");

function buildUserPrompt(bundle: EvidenceBundle): string {
  return `Evidence bundle:\n${JSON.stringify(bundle, null, 2)}`;
}

/** Keep only cited keys that really exist in the bundle. */
function checkCitations(
  bundle: EvidenceBundle,
  cited: string[],
): { keys: string[]; unverified: boolean } {
  const allowed = new Set(bundle.evidence.map((item) => item.key));
  const keys = [...new Set(cited)].filter((key) => allowed.has(key));
  return { keys, unverified: keys.length !== new Set(cited).size };
}

function templateRationale(bundle: EvidenceBundle, deps: RationaleDeps): Rationale {
  const text = buildTemplateRationale(bundle);
  return {
    ...text,
    model: "template",
    promptVersion: deps.promptVersion,
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    unverifiedCitations: false,
    source: "template",
  };
}

/** Try each model (primary, then fallbacks), each up to twice. Returns null if all fail. */
async function askModels(bundle: EvidenceBundle, deps: RationaleDeps): Promise<Rationale | null> {
  for (const { model, provider } of deps.models) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const output = await provider.generateJson({
          schema: RationaleOutputSchema,
          system: SYSTEM_PROMPT,
          user: buildUserPrompt(bundle),
          maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
          timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        const citations = checkCitations(bundle, output.citedEvidenceKeys);
        return {
          summary: cutSummary(output.summary),
          assessment: output.assessment,
          citedEvidenceKeys: citations.keys,
          model,
          promptVersion: deps.promptVersion,
          generatedAt: (deps.now?.() ?? new Date()).toISOString(),
          unverifiedCitations: citations.unverified,
          source: "llm",
        };
      } catch (err) {
        logger.warn("rationale model call failed", {
          model,
          attempt,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        });
      }
    }
  }
  return null;
}

/**
 * One rationale for one flag.
 *  - off: template only
 *  - cached: AnalysisCache hit, otherwise template
 *  - live: cache hit (unless refresh), otherwise ask the models, write through, otherwise template
 */
export async function getRationale(
  bundle: EvidenceBundle,
  deps: RationaleDeps,
  options: { refresh?: boolean } = {},
): Promise<Rationale> {
  if (deps.mode === "off") return templateRationale(bundle, deps);

  const key = rationaleCacheKey(bundle, deps.promptVersion);
  if (!(deps.mode === "live" && options.refresh)) {
    const hit = await deps.store.get(key);
    if (hit) return { ...hit, source: "cache" };
  }
  if (deps.mode === "cached") return templateRationale(bundle, deps);

  const fresh = await askModels(bundle, deps);
  if (!fresh) return templateRationale(bundle, deps);

  await deps.store.set(key, toStoredRationale(fresh));
  return fresh;
}

/** Many rationales, at most `concurrency` model calls at a time. Results keep the input order. */
export async function getRationales(
  bundles: EvidenceBundle[],
  deps: RationaleDeps,
  options: { refresh?: boolean; concurrency?: number } = {},
): Promise<Rationale[]> {
  const results: Rationale[] = new Array(bundles.length);
  let next = 0;

  async function worker() {
    while (next < bundles.length) {
      const index = next++;
      results[index] = await getRationale(bundles[index]!, deps, options);
    }
  }

  const workers = Math.min(options.concurrency ?? LLM_CONCURRENCY, bundles.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/** Build deps from LLM_MODE / OPENROUTER_API_KEY / LLM_MODEL_* in the environment. */
export function createRationaleDepsFromEnv(store: RationaleStore): RationaleDeps {
  const env = getEnv();
  const names = [
    env.LLM_MODEL_PRIMARY,
    ...env.LLM_MODEL_FALLBACKS.split(",").map((name) => name.trim()),
  ].filter(Boolean);

  // live mode without a key or model just ends up with the template (no crash)
  const canCallModels = env.LLM_MODE === "live" && Boolean(env.OPENROUTER_API_KEY);
  if (env.LLM_MODE === "live" && !canCallModels) {
    logger.warn("LLM_MODE=live but OPENROUTER_API_KEY is empty; using templates");
  }

  return {
    mode: env.LLM_MODE,
    promptVersion: env.LLM_PROMPT_VERSION,
    store,
    models: canCallModels
      ? names.map((model) => ({
          model,
          provider: createOpenRouterProvider({ apiKey: env.OPENROUTER_API_KEY, model }),
        }))
      : [],
  };
}
