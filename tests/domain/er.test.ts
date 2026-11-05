import { describe, expect, it } from "vitest";
import {
  MATCH_THRESHOLD,
  REVIEW_THRESHOLD,
  bandFor,
  buildErFeatures,
  isNearIdentical,
  jaroWinkler,
  levenshtein,
  levenshteinSimilarity,
  nameSimilarity,
  scoreErFeatures,
  tokenSortRatio,
  type ErFeatures,
} from "@/domain/er";
import { loadErWeights, type ErWeights } from "@/domain/er-weights";

// a fixed weights object so these tests do not move when we re-tune er-weights.v1.json
const testWeights: ErWeights = {
  version: "test",
  bias: -4,
  weights: {
    vecCos: 2,
    nameJW: 2,
    nameTokenSort: 2,
    nameNearIdentical: 1,
    emailLocalSim: 1,
    sameDestination: 2,
    countryMismatchPenalty: 1,
  },
  caps: { suffixConflictMax: 0.5, countryMismatchMax: 0.6, countryMismatchEmailSimBelow: 0.4 },
};

const strong: ErFeatures = {
  vecCos: 1,
  nameJW: 1,
  nameTokenSort: 1,
  nameNearIdentical: 1,
  emailLocalSim: 1,
  sameDestination: 1,
  sameCountry: 1,
  suffixConflict: 0,
  sameAmountThisCycle: 0,
};

describe("string metrics", () => {
  it("levenshtein counts edits", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("levenshteinSimilarity is 1 for equal and 0 for empty/empty", () => {
    expect(levenshteinSimilarity("john", "john")).toBe(1);
    expect(levenshteinSimilarity("", "")).toBe(0);
    expect(levenshteinSimilarity("abcd", "abce")).toBeCloseTo(0.75);
  });

  it("jaroWinkler matches the textbook values", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler("dixon", "dicksonx")).toBeCloseTo(0.8133, 3);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(jaroWinkler("same", "same")).toBe(1);
  });

  it("tokenSortRatio ignores word order and spacing", () => {
    expect(tokenSortRatio("john doe", "doe john")).toBe(1);
    expect(tokenSortRatio("al rashid", "alrashid")).toBe(1);
    expect(tokenSortRatio("john doe", "jane roe")).toBeLessThan(0.7);
  });

  it("nameSimilarity handles reordering and initials", () => {
    expect(nameSimilarity("doe john", "john doe")).toBeGreaterThan(0.95);
    expect(nameSimilarity("j smith", "john smith")).toBeGreaterThan(0.9);
    expect(nameSimilarity("john doe", "mary ann")).toBeLessThan(0.6);
  });

  it("isNearIdentical means one typo or the same words reordered", () => {
    expect(isNearIdentical("john doe", "jon doe")).toBe(true);
    expect(isNearIdentical("doe john", "john doe")).toBe(true);
    expect(isNearIdentical("john doe", "jane doe")).toBe(false);
    expect(isNearIdentical("", "")).toBe(false);
  });
});

describe("buildErFeatures", () => {
  it("builds the S1 hero features (Jon Doe vs John Doe)", () => {
    const f = buildErFeatures(
      { name: "Jon Doe", email: "jon.doe.pay@example.net", country: null },
      { name: "John Doe", email: "john.doe@example.com", country: "US" },
      { vecCos: 0.67, sameAmountThisCycle: true },
    );
    expect(f.vecCos).toBeCloseTo(0.67);
    expect(f.nameJW).toBeGreaterThan(0.95);
    expect(f.nameNearIdentical).toBe(1);
    expect(f.emailLocalSim).toBeCloseTo(0.545, 2);
    expect(f.sameDestination).toBe(0);
    expect(f.sameCountry).toBeNull(); // new payee: country unknown
    expect(f.suffixConflict).toBe(0);
    expect(f.sameAmountThisCycle).toBe(1);
  });

  it("clamps the cosine to 0..1", () => {
    const a = { name: "A B", email: "a@x.com" };
    expect(buildErFeatures(a, a, { vecCos: -0.4 }).vecCos).toBe(0);
    expect(buildErFeatures(a, a, { vecCos: 1.2 }).vecCos).toBe(1);
  });

  it("sameDestination uses the normalized email (gmail dots and +tags)", () => {
    const f = buildErFeatures(
      { name: "Linda Park", email: "linda.park@gmail.com" },
      { name: "Linda Park", email: "l.i.n.d.a.park+pay@gmail.com" },
      { vecCos: 1 },
    );
    expect(f.sameDestination).toBe(1);
  });

  it("different local parts on a non-gmail domain are not the same destination", () => {
    const f = buildErFeatures(
      { name: "A B", email: "a.b@example.com" },
      { name: "A B", email: "ab@example.com" },
      { vecCos: 1 },
    );
    expect(f.sameDestination).toBe(0);
  });

  it("sameCountry is 1, 0 or null (unknown)", () => {
    const base = { name: "A B", email: "a@x.com" };
    expect(buildErFeatures({ ...base, country: "us" }, { ...base, country: "US" }, { vecCos: 1 }).sameCountry).toBe(1);
    expect(buildErFeatures({ ...base, country: "US" }, { ...base, country: "SG" }, { vecCos: 1 }).sameCountry).toBe(0);
    expect(buildErFeatures({ ...base, country: "US" }, { ...base, country: null }, { vecCos: 1 }).sameCountry).toBeNull();
  });

  it("flags a Sr. vs Jr. suffix conflict, but not Mr. vs nothing", () => {
    const sr = { name: "Robert Chen Sr.", email: "r.sr@x.com" };
    const jr = { name: "Robert Chen Jr.", email: "r.jr@x.com" };
    expect(buildErFeatures(sr, jr, { vecCos: 1 }).suffixConflict).toBe(1);
    expect(buildErFeatures(sr, sr, { vecCos: 1 }).suffixConflict).toBe(0);
    const plain = { name: "Robert Chen", email: "r@x.com" };
    const mr = { name: "Mr. Robert Chen", email: "r2@x.com" };
    expect(buildErFeatures(plain, mr, { vecCos: 1 }).suffixConflict).toBe(0);
  });

  it("diacritics and punctuation do not matter", () => {
    const f = buildErFeatures(
      { name: "José Martínez", email: "a@x.com" },
      { name: "Jose  Martinez", email: "b@x.com" },
      { vecCos: 1 },
    );
    expect(f.nameJW).toBe(1);
    expect(f.nameNearIdentical).toBe(1);
  });
});

describe("scoreErFeatures", () => {
  it("scores strong evidence as MATCH and no evidence as NONE", () => {
    expect(scoreErFeatures(strong, testWeights).band).toBe("MATCH");
    const weak: ErFeatures = {
      ...strong,
      vecCos: 0.1,
      nameJW: 0.2,
      nameTokenSort: 0.1,
      nameNearIdentical: 0,
      emailLocalSim: 0,
      sameDestination: 0,
    };
    expect(scoreErFeatures(weak, testWeights).band).toBe("NONE");
  });

  it("sameAmountThisCycle is context only and never changes the score", () => {
    const a = scoreErFeatures({ ...strong, sameAmountThisCycle: 0 }, testWeights).score;
    const b = scoreErFeatures({ ...strong, sameAmountThisCycle: 1 }, testWeights).score;
    expect(a).toBe(b);
  });

  it("suffix conflict caps the score at 0.5, below REVIEW", () => {
    const result = scoreErFeatures({ ...strong, suffixConflict: 1 }, testWeights);
    expect(result.rawScore).toBeGreaterThan(MATCH_THRESHOLD);
    expect(result.score).toBe(0.5);
    expect(result.caps).toEqual(["suffixConflict"]);
    expect(result.band).toBe("NONE");
  });

  it("different country + different destination + dissimilar email caps at 0.6", () => {
    const features: ErFeatures = { ...strong, sameCountry: 0, sameDestination: 0, emailLocalSim: 0.3 };
    const strongWeights: ErWeights = { ...testWeights, bias: 5, weights: { ...testWeights.weights, countryMismatchPenalty: 0 } };
    const result = scoreErFeatures(features, strongWeights);
    expect(result.rawScore).toBeGreaterThan(0.9);
    expect(result.score).toBe(0.6);
    expect(result.caps).toEqual(["countryMismatch"]);
    expect(result.band).toBe("NONE");
  });

  it("the country cap does not apply with a similar email, the same destination, or an unknown country", () => {
    const strongWeights: ErWeights = { ...testWeights, bias: 5, weights: { ...testWeights.weights, countryMismatchPenalty: 0 } };
    const similarEmail = scoreErFeatures({ ...strong, sameCountry: 0, sameDestination: 0, emailLocalSim: 0.9 }, strongWeights);
    const sameDestination = scoreErFeatures({ ...strong, sameCountry: 0, sameDestination: 1, emailLocalSim: 0.3 }, strongWeights);
    const unknownCountry = scoreErFeatures({ ...strong, sameCountry: null, sameDestination: 0, emailLocalSim: 0.3 }, strongWeights);
    for (const result of [similarEmail, sameDestination, unknownCountry]) {
      expect(result.caps).toEqual([]);
      expect(result.score).toBeGreaterThan(0.9);
    }
  });

  it("a known country mismatch lowers the score (penalty)", () => {
    const same = scoreErFeatures({ ...strong, sameCountry: 1 }, testWeights).rawScore;
    const different = scoreErFeatures({ ...strong, sameCountry: 0 }, testWeights).rawScore;
    expect(different).toBeLessThan(same);
  });

  it("the committed weights load and keep the caps below the REVIEW threshold", () => {
    const weights = loadErWeights();
    expect(weights.version).toBe("er.v1");
    expect(weights.caps.suffixConflictMax).toBeLessThan(REVIEW_THRESHOLD);
    expect(weights.caps.countryMismatchMax).toBeLessThan(REVIEW_THRESHOLD);
  });
});

describe("bands", () => {
  it("uses 0.85 for MATCH and 0.65 for REVIEW (inclusive)", () => {
    expect(MATCH_THRESHOLD).toBe(0.85);
    expect(REVIEW_THRESHOLD).toBe(0.65);
    expect(bandFor(0.85)).toBe("MATCH");
    expect(bandFor(0.8499)).toBe("REVIEW");
    expect(bandFor(0.65)).toBe("REVIEW");
    expect(bandFor(0.6499)).toBe("NONE");
    expect(bandFor(0)).toBe("NONE");
    expect(bandFor(1)).toBe("MATCH");
  });
});
