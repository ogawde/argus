import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { LlmProvider } from "@/server/llm/provider";
import {
  getRationale,
  getRationales,
  type RationaleDeps,
  type RationaleStore,
  type StoredRationale,
} from "@/server/llm/rationale";
import { bundleFromFlag, rationaleCacheKey, type EvidenceBundle } from "@/server/llm/template";
import { createOpenRouterProvider, extractJsonText } from "@/server/llm/openrouter";

const bundle: EvidenceBundle = bundleFromFlag({
  ruleId: "ENTITY_MATCH",
  severity: "CRITICAL",
  blocking: true,
  evidence: [
    { key: "er.vector", label: "Vector similarity", value: 0.67 },
    { key: "er.fuzzyName", label: "Fuzzy name similarity", value: 0.967 },
    { key: "er.score", label: "Match score", value: 0.92 },
    { key: "er.matchedPayee", label: "Matched payee", value: "John Doe (P-0118)" },
  ],
});

function memoryStore(): RationaleStore & { data: Map<string, StoredRationale> } {
  const data = new Map<string, StoredRationale>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
  };
}

/** A fake provider that answers from a list: a value is returned, an Error is thrown. */
function scriptedProvider(answers: Array<unknown | Error>): LlmProvider & { calls: number } {
  const provider = {
    calls: 0,
    async generateJson<T>(args: { schema: z.ZodType<T> }): Promise<T> {
      const answer = answers[provider.calls++];
      if (answer instanceof Error) throw answer;
      return args.schema.parse(answer); // like the real provider: schema errors throw
    },
  };
  return provider;
}

const good = {
  summary: "Jon Doe looks like John Doe.",
  assessment: "LIKELY_FRAUD",
  citedEvidenceKeys: ["er.vector", "er.score"],
};

function makeDeps(overrides: Partial<RationaleDeps>): RationaleDeps {
  return {
    mode: "live",
    promptVersion: "v1",
    store: memoryStore(),
    models: [],
    now: () => new Date("2026-10-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("getRationale", () => {
  it("off mode returns the template and never calls a model", async () => {
    const provider = scriptedProvider([good]);
    const result = await getRationale(bundle, makeDeps({ mode: "off", models: [{ model: "m1", provider }] }));
    expect(result.source).toBe("template");
    expect(result.model).toBe("template");
    expect(provider.calls).toBe(0);
    expect(result.summary.length).toBeLessThanOrEqual(280);
  });

  it("live mode uses the model and writes through to the cache", async () => {
    const store = memoryStore();
    const provider = scriptedProvider([good]);
    const result = await getRationale(bundle, makeDeps({ store, models: [{ model: "m1", provider }] }));
    expect(result.source).toBe("llm");
    expect(result.model).toBe("m1");
    expect(result.unverifiedCitations).toBe(false);
    expect(store.data.get(rationaleCacheKey(bundle, "v1"))?.model).toBe("m1");
  });

  it("drops cited keys that are not in the bundle and marks the rationale unverified", async () => {
    const provider = scriptedProvider([{ ...good, citedEvidenceKeys: ["er.vector", "er.madeUp", "bank.balance"] }]);
    const result = await getRationale(bundle, makeDeps({ models: [{ model: "m1", provider }] }));
    expect(result.citedEvidenceKeys).toEqual(["er.vector"]);
    expect(result.unverifiedCitations).toBe(true);
  });

  it("invalid output is retried once on the same model", async () => {
    const provider = scriptedProvider([{ nope: true }, good]);
    const result = await getRationale(bundle, makeDeps({ models: [{ model: "m1", provider }] }));
    expect(provider.calls).toBe(2);
    expect(result.source).toBe("llm");
    expect(result.model).toBe("m1");
  });

  it("trims a summary that is longer than 280 characters", async () => {
    const provider = scriptedProvider([{ summary: "x".repeat(400), assessment: "SUSPICIOUS", citedEvidenceKeys: [] }]);
    const result = await getRationale(bundle, makeDeps({ models: [{ model: "m1", provider }] }));
    expect(result.source).toBe("llm");
    expect(result.summary.length).toBeLessThanOrEqual(280);
    expect(result.summary.endsWith("…")).toBe(true);
  });

  it("falls back to the next model after two failures", async () => {
    const primary = scriptedProvider([new Error("429"), { summary: "ok", assessment: "NOPE", citedEvidenceKeys: [] }]);
    const fallback = scriptedProvider([good]);
    const result = await getRationale(
      bundle,
      makeDeps({ models: [{ model: "primary", provider: primary }, { model: "fallback", provider: fallback }] }),
    );
    expect(primary.calls).toBe(2);
    expect(result.model).toBe("fallback");
  });

  it("falls back to the template when every model fails, and does not cache it", async () => {
    const store = memoryStore();
    const broken = scriptedProvider([new Error("a"), new Error("b")]);
    const result = await getRationale(bundle, makeDeps({ store, models: [{ model: "m1", provider: broken }] }));
    expect(result.source).toBe("template");
    expect(store.data.size).toBe(0);
  });

  it("live mode without models (no key) still gives a template", async () => {
    const result = await getRationale(bundle, makeDeps({ models: [] }));
    expect(result.source).toBe("template");
  });

  it("cached mode returns a hit and never calls a model", async () => {
    const store = memoryStore();
    const stored: StoredRationale = {
      summary: "From the committed cache.",
      assessment: "SUSPICIOUS",
      citedEvidenceKeys: ["er.score"],
      model: "some/model",
      promptVersion: "v1",
      generatedAt: "2026-10-01T00:00:00.000Z",
      unverifiedCitations: false,
    };
    store.data.set(rationaleCacheKey(bundle, "v1"), stored);
    const provider = scriptedProvider([good]);

    const result = await getRationale(bundle, makeDeps({ mode: "cached", store, models: [{ model: "m1", provider }] }));
    expect(result.source).toBe("cache");
    expect(result.model).toBe("some/model");
    expect(provider.calls).toBe(0);
  });

  it("cached mode with a miss gives the template", async () => {
    const result = await getRationale(bundle, makeDeps({ mode: "cached" }));
    expect(result.source).toBe("template");
  });

  it("the cache key ignores the model but depends on evidence and prompt version", () => {
    const other = bundleFromFlag({ ruleId: "ENTITY_MATCH", severity: "WARN", blocking: false, evidence: [] });
    expect(rationaleCacheKey(bundle, "v1")).toBe(rationaleCacheKey(bundle, "v1"));
    expect(rationaleCacheKey(bundle, "v1")).not.toBe(rationaleCacheKey(bundle, "v2"));
    expect(rationaleCacheKey(bundle, "v1")).not.toBe(rationaleCacheKey(other, "v1"));
  });

  it("the template for ENTITY_MATCH cites real keys only", async () => {
    const result = await getRationale(bundle, makeDeps({ mode: "off" }));
    const allowed = new Set(bundle.evidence.map((item) => item.key));
    expect(result.citedEvidenceKeys.length).toBeGreaterThan(0);
    for (const key of result.citedEvidenceKeys) expect(allowed.has(key)).toBe(true);
  });
});

describe("getRationales", () => {
  it("runs at most 3 model calls at the same time and keeps the order", async () => {
    let running = 0;
    let peak = 0;
    const slow: LlmProvider = {
      async generateJson<T>(args: { schema: z.ZodType<T> }): Promise<T> {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;
        return args.schema.parse(good);
      },
    };
    const bundles = Array.from({ length: 8 }, (_, i) =>
      bundleFromFlag({ ruleId: "R", severity: "WARN", blocking: false, evidence: [{ key: "n", label: "n", value: i }] }),
    );
    const results = await getRationales(bundles, makeDeps({ models: [{ model: "m", provider: slow }] }));
    expect(results).toHaveLength(8);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

describe("openrouter provider", () => {
  const schema = { parse: (value: unknown) => value } as unknown as z.ZodType<{ ok: boolean }>;
  const args = { schema, system: "s", user: "u", maxTokens: 50, timeoutMs: 1000 };

  function reply(content: string) {
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }

  it("extracts JSON out of code fences", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("retries on 429 with backoff, then succeeds", async () => {
    const statuses = [429, 429, 200];
    const sleeps: number[] = [];
    const provider = createOpenRouterProvider({
      apiKey: "k",
      model: "m",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: (async () => {
        const status = statuses.shift()!;
        return status === 429 ? new Response("slow down", { status }) : reply('{"ok":true}');
      }) as typeof fetch,
    });
    await expect(provider.generateJson(args)).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("throws on other HTTP errors and on empty content", async () => {
    const failing = createOpenRouterProvider({
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => new Response("no", { status: 500 })) as typeof fetch,
    });
    await expect(failing.generateJson(args)).rejects.toThrow("HTTP 500");

    const empty = createOpenRouterProvider({
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => reply("")) as typeof fetch,
    });
    await expect(empty.generateJson(args)).rejects.toThrow("empty");
  });
});
