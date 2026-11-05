import type { Flag } from "@/domain/plan";
import { canonicalize, sha256 } from "@/domain/hash";

/** Everything the model (or the template) is allowed to know about one flag. */
export interface EvidenceBundle {
  ruleId: string;
  severity: string;
  blocking: boolean;
  evidence: Array<{ key: string; label: string; value: string | number | boolean }>;
}

export const ASSESSMENTS = ["LIKELY_FRAUD", "SUSPICIOUS", "LIKELY_BENIGN", "INSUFFICIENT"] as const;
export type Assessment = (typeof ASSESSMENTS)[number];

/** The advisory text, without bookkeeping fields. */
export interface RationaleText {
  summary: string;
  assessment: Assessment;
  citedEvidenceKeys: string[];
}

/**
 * Build the bundle from a flag. Same flag evidence -> same bundle -> same cache key.
 * Decimals become strings because canonicalize() only accepts integers.
 */
export function bundleFromFlag(flag: Pick<Flag, "ruleId" | "severity" | "blocking" | "evidence">): EvidenceBundle {
  const evidence = flag.evidence
    .map((item) => ({
      key: item.key,
      label: item.label,
      value:
        typeof item.value === "number" && !Number.isSafeInteger(item.value)
          ? String(item.value)
          : item.value,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { ruleId: flag.ruleId, severity: flag.severity, blocking: flag.blocking, evidence };
}

/** `rationale:` + sha256(canonical bundle + prompt version). The model is NOT part of the key. */
export function rationaleCacheKey(bundle: EvidenceBundle, promptVersion: string): string {
  return `rationale:${sha256(canonicalize(bundle) + promptVersion)}`;
}

function valueOf(bundle: EvidenceBundle, key: string): string | number | boolean | undefined {
  return bundle.evidence.find((item) => item.key === key)?.value;
}

function cut(text: string, max = 280): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const ER_KEYS = [
  "er.score",
  "er.vector",
  "er.fuzzyName",
  "er.emailLocal",
  "er.sameDestination",
  "er.context.sameAmount",
];

/** Deterministic rationale built only from the evidence. Used for LLM_MODE=off, cache misses and failures. */
export function buildTemplateRationale(bundle: EvidenceBundle): RationaleText {
  const assessment: Assessment =
    bundle.severity === "CRITICAL" ? "SUSPICIOUS" : bundle.severity === "INFO" ? "LIKELY_BENIGN" : "INSUFFICIENT";

  if (bundle.ruleId === "ENTITY_MATCH") {
    const matched = valueOf(bundle, "er.matchedPayee") ?? "an existing payee";
    const profile = valueOf(bundle, "er.matchedProfile");
    const score = valueOf(bundle, "er.score");
    const sameAmount = valueOf(bundle, "er.context.sameAmount") === true;
    const parts = [
      `Name and identity look similar to ${matched}${profile ? ` (${profile})` : ""}.`,
      score !== undefined ? `Match score ${score}.` : "",
      sameAmount ? "The amount is the same as that payee's line this cycle." : "",
      bundle.blocking ? "Check this is a different person before paying." : "A reviewer should confirm.",
    ];
    return {
      summary: cut(parts.filter(Boolean).join(" ")),
      assessment,
      citedEvidenceKeys: ER_KEYS.filter((key) => valueOf(bundle, key) !== undefined),
    };
  }

  const top = bundle.evidence.slice(0, 3);
  const facts = top.map((item) => `${item.label}: ${item.value}`).join("; ");
  return {
    summary: cut(`${bundle.ruleId} flagged at ${bundle.severity}${facts ? `. ${facts}` : ""}.`),
    assessment,
    citedEvidenceKeys: top.map((item) => item.key),
  };
}
