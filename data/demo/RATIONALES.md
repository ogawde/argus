# Demo rationale cache

`rationales.cache.json` maps a cache key to one advisory rationale
(`summary`, `assessment`, `citedEvidenceKeys`, `model`, `promptVersion`, `generatedAt`).

- The key is `rationale:` + sha256 of the flag's evidence bundle + `LLM_PROMPT_VERSION`.
  Change the evidence or the prompt version and the old entry is simply not found (the app then uses a template).
- `pnpm seed:demo` loads this file into the `AnalysisCache` table. `LLM_MODE=cached` reads it.
- Entries with `"model": "template"` are deterministic text built from the evidence (no AI).
  Entries with a real model name came from OpenRouter.

To generate real rationales (needs an OpenRouter key):

```bash
# .env.local
LLM_MODE=live
OPENROUTER_API_KEY=...
LLM_MODEL_PRIMARY=<model id>
LLM_MODEL_FALLBACKS=<comma separated model ids>

pnpm seed:rationales -- --refresh
```

Then commit the updated `rationales.cache.json`. Existing entries are never replaced by templates.
