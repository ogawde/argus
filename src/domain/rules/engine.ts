import type { Analysis, Flag } from "../plan";
import { sha256, canonicalize } from "../hash";
import { ruleAmountDeviation } from "./amount-deviation";
import { ruleBatchTotalDeviation } from "./batch-total";
import { ruleDestinationChanged } from "./destination-changed";
import { ruleDormantReactivation } from "./dormant-reactivation";
import { ruleDuplicateInBatch } from "./duplicate-in-batch";
import { ruleDuplicatePaymentWindow } from "./duplicate-payment-window";
import { ruleNewPayee } from "./new-payee";
import { ruleSharedDestination } from "./shared-destination";
import type { ElasticRuleInputs, RuleContext, RuleFn } from "./types";
import { ruleVelocitySpike } from "./velocity-spike";

/** Phase 2 domain rules only (no Elastic). */
export const PHASE2_RULES: RuleFn[] = [
  ruleNewPayee,
  ruleDestinationChanged,
  ruleAmountDeviation,
  ruleDuplicateInBatch,
  ruleDuplicatePaymentWindow,
  ruleDormantReactivation,
  ruleBatchTotalDeviation,
];

function dedupeFlags(flags: Flag[]): Flag[] {
  const seen = new Set<string>();
  const out: Flag[] = [];
  for (const f of flags) {
    const key = `${f.lineId}|${f.ruleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export function runPhase2Rules(ctx: RuleContext): Flag[] {
  const all = PHASE2_RULES.flatMap((r) => r(ctx));
  return dedupeFlags(all);
}

/**
 * Phase 3 Elastic rules (VELOCITY_SPIKE, SHARED_DESTINATION).
 * Planning fetches `ElasticRuleInputs` with `fetchElasticRuleInputs()` and merges the
 * result with `runPhase2Rules()`.
 */
export function runPhase3ElasticRules(ctx: RuleContext, inputs: ElasticRuleInputs): Flag[] {
  return dedupeFlags([
    ...ruleVelocitySpike(ctx, inputs.velocityHits),
    ...ruleSharedDestination(ctx, inputs.sharedDestinations),
  ]);
}

export function buildAnalysis(
  planHashValue: string,
  flags: Flag[],
  policyVersion: string,
): Analysis {
  return {
    planHash: planHashValue,
    flags,
    engineVersions: {
      policy: policyVersion,
      erWeights: "er.v0-deferred",
      esMapping: "es.v0-deferred",
    },
  };
}

export function analysisHash(analysis: Analysis): string {
  return sha256(
    canonicalize({
      planHash: analysis.planHash,
      flags: analysis.flags,
      engineVersions: analysis.engineVersions,
    }),
  );
}
