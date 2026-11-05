import { loadEnvFiles } from "../load-env";

loadEnvFiles();

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectDemoFlags } from "./demo-flags";

/**
 * pnpm seed:rationales [-- --refresh]
 *
 * Writes data/demo/rationales.cache.json: one rationale per demo flag, keyed by the evidence bundle.
 *  - LLM_MODE=live + OPENROUTER_API_KEY + LLM_MODEL_PRIMARY set: real model output (commit the file!)
 *  - otherwise: deterministic template rationales for flags that have no entry yet
 * Existing entries are kept (so a template run never overwrites model output).
 * --refresh asks the model again for every flag.
 */

export const RATIONALE_CACHE_FILE = path.join("data", "demo", "rationales.cache.json");

async function main() {
  // import after env is loaded
  const { getEnv } = await import("../../src/lib/env");
  const { createRationaleDepsFromEnv, getRationales, toStoredRationale } = await import("../../src/server/llm/rationale");
  const { bundleFromFlag, rationaleCacheKey } = await import("../../src/server/llm/template");

  type Stored = import("../../src/server/llm/rationale").StoredRationale;

  const refresh = process.argv.includes("--refresh");
  const file = path.join(process.cwd(), RATIONALE_CACHE_FILE);
  const entries: Record<string, Stored> = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, Stored>)
    : {};

  const { flags, skipped } = await collectDemoFlags();
  for (const message of skipped) console.warn(`skipped: ${message}`);

  const env = getEnv();
  const canUseModels = env.LLM_MODE === "live" && Boolean(env.OPENROUTER_API_KEY);
  const deps = createRationaleDepsFromEnv({
    get: async (key) => entries[key] ?? null,
    set: async (key, value) => {
      entries[key] = value;
    },
  });
  // without a key we read the file and fall back to templates
  deps.mode = canUseModels ? "live" : "cached";

  const bundles = flags.map(bundleFromFlag);
  const results = await getRationales(bundles, deps, { refresh });

  let fromModel = 0;
  let fromTemplate = 0;
  results.forEach((result, index) => {
    const key = rationaleCacheKey(bundles[index]!, deps.promptVersion);
    if (result.source === "llm") fromModel++;
    if (result.source === "template") {
      fromTemplate++;
      if (!entries[key]) {
        entries[key] = toStoredRationale(result);
      }
    }
  });

  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n", "utf8");

  console.log(`rationales: ${flags.length} flags, ${Object.keys(sorted).length} cache entries`);
  console.log(`  from model   : ${fromModel}${canUseModels ? "" : " (no live key, LLM_MODE != live)"}`);
  console.log(`  from template: ${fromTemplate}`);
  console.log(`  wrote ${RATIONALE_CACHE_FILE}`);
  if (!canUseModels) {
    console.log("  set LLM_MODE=live, OPENROUTER_API_KEY and LLM_MODEL_PRIMARY, then run again with --refresh");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
