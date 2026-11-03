import { z } from "zod";

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v === "true" || v === "1"));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(16),
  DEMO_AUTH: boolish.default(true),
  DEMO_MODE: boolish.default(true),
  DEMO_CYCLE_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  DATABASE_URL: z.string().min(1),
  ELASTICSEARCH_URL: z.string().url(),
  ES_INDEX_VERSION: z.string().default("v1"),

  EMBEDDING_PROVIDER: z.enum(["local"]).default("local"),
  EMBEDDING_MODEL_DIMS: z.coerce.number().int().default(384),

  LLM_MODE: z.enum(["live", "cached", "off"]).default("cached"),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  LLM_MODEL_PRIMARY: z.string().optional().default(""),
  LLM_MODEL_FALLBACKS: z.string().optional().default(""),
  LLM_PROMPT_VERSION: z.string().default("v1"),

  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_API_BASE: z.string().url().default("https://api-m.sandbox.paypal.com"),
  PAYPAL_CLIENT_ID: z.string().optional().default(""),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(""),
  PAYPAL_WEBHOOK_ID: z.string().optional().default(""),
  PAYPAL_WEBHOOK_VERIFY: z.enum(["strict", "off"]).default("off"),
  SANDBOX_RECEIVER_POOL: z.string().optional().default(""),
  RECONCILE_POLL_MS: z.coerce.number().int().positive().default(3000),
  TUNNEL_BASE_URL: z.string().optional().default(""),

  NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY: z.string().optional().default(""),
  ENABLE_STUDIO_AGENT: boolish.default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

export function hasPayPalCreds(env: Env = getEnv()): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}

/** Reset cached env (tests / preflight). */
export function resetEnvCache(): void {
  cached = null;
}
