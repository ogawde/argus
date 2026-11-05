import { z } from "zod";
import weightsJson from "./er-weights.v1.json";

const ErWeightsSchema = z.object({
  version: z.string(),
  bias: z.number(),
  weights: z.object({
    vecCos: z.number(),
    nameJW: z.number(),
    nameTokenSort: z.number(),
    nameNearIdentical: z.number(),
    emailLocalSim: z.number(),
    sameDestination: z.number(),
    /** subtracted when both countries are known and different */
    countryMismatchPenalty: z.number(),
  }),
  caps: z.object({
    /** suffix conflict (Sr. vs Jr.) → score can never be above this */
    suffixConflictMax: z.number().min(0).max(1),
    /** different country + different destination + dissimilar email → score can never be above this */
    countryMismatchMax: z.number().min(0).max(1),
    countryMismatchEmailSimBelow: z.number().min(0).max(1),
  }),
});

export type ErWeights = z.infer<typeof ErWeightsSchema>;

let cached: ErWeights | null = null;

/** Loads the committed weights file (versioned, validated once). */
export function loadErWeights(): ErWeights {
  if (cached) return cached;
  cached = ErWeightsSchema.parse(weightsJson);
  return cached;
}

export function resetErWeightsCache(): void {
  cached = null;
}
