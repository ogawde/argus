import { describe, expect, it } from "vitest";
import type { PlanFile, PlanLine } from "@/domain/plan";
import { loadPolicy } from "@/domain/policy";
import type { EmbeddingProvider } from "@/server/embeddings";
import type { ErCandidate, IdentityQuery } from "@/server/er/retrieve";
import { pickRiskyLines, resolveEntityMatches, type ErPayee } from "@/server/er/resolve";

const cycleDate = new Date("2026-10-28T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function line(overrides: Partial<PlanLine> & { lineId: string; payeeRef: string; displayName: string }): PlanLine {
  return {
    sourceRow: 1,
    payeeId: null,
    destination: { type: "EMAIL", value: "someone@example.com" },
    amount: { minor: 2250, currency: "USD" },
    note: "",
    include: true,
    ...overrides,
  };
}

function plan(lines: PlanLine[]): PlanFile {
  return {
    schemaVersion: 1,
    kind: "payout-plan",
    runId: "test",
    parentHash: null,
    source: { filename: "t.csv", sha256: "x", rowCount: lines.length },
    cycleDate: "2026-10-28",
    baseline: { payeeMasterVersion: 1, historyWatermark: "2026-10-01T00:00:00.000Z", policyVersion: "policy.v1" },
    currency: "USD",
    lines,
    totals: { includedCount: lines.length, includedMinor: 0 },
  };
}

function payee(id: string, name: string, daysOld: number, extra: Partial<ErPayee> = {}): ErPayee {
  return {
    id,
    displayName: name,
    country: "US",
    destinationFingerprint: `fp-${id}`,
    createdAt: new Date(cycleDate.getTime() - daysOld * DAY),
    destinationChangedAt: null,
    ...extra,
  };
}

/** Fake embeddings: the same text always gives the same vector, similar-looking names are close. */
const fakeEmbeddings: EmbeddingProvider = {
  id: "fake",
  dims: 2,
  async embed(texts) {
    return texts.map((text) => (text.startsWith("jon") || text.startsWith("john") ? [1, 0] : [0, 1]));
  },
};

function candidate(overrides: Partial<ErCandidate>): ErCandidate {
  return {
    payeeId: "P-0118",
    nameRaw: "John Doe",
    nameNormalized: "john doe",
    emailNormalized: "john.doe@example.com",
    emailLocalNormalized: "john.doe",
    destinationFingerprint: "fp-P-0118",
    country: "US",
    identityText: "john doe | john.doe | US",
    vectorCos: 0.95,
    channels: ["vector", "fuzzyName"],
    ...overrides,
  };
}

describe("pickRiskyLines", () => {
  it("picks new, recent, destination-changed and duplicate-name lines, not established ones", () => {
    const lines = [
      line({ lineId: "L1", payeeRef: "N1", displayName: "Jon Doe" }), // new
      line({ lineId: "L2", payeeRef: "P1", payeeId: "P1", displayName: "Recent Person" }), // created 5 days ago
      line({ lineId: "L3", payeeRef: "P2", payeeId: "P2", displayName: "Changed Person" }), // destination changed 3 days ago
      line({ lineId: "L4", payeeRef: "P3", payeeId: "P3", displayName: "Old Person" }), // established
      line({ lineId: "L5", payeeRef: "P4", payeeId: "P4", displayName: "Maria Garcia" }),
      line({ lineId: "L6", payeeRef: "P5", payeeId: "P5", displayName: "Maria Garcia" }),
      line({ lineId: "L7", payeeRef: "P6", payeeId: "P6", displayName: "Aiko Tanaka" }), // listed twice, same payee
      line({ lineId: "L8", payeeRef: "P6", payeeId: "P6", displayName: "Aiko Tanaka" }),
    ];
    const payeesById = new Map<string, ErPayee>([
      ["P1", payee("P1", "Recent Person", 5)],
      ["P2", payee("P2", "Changed Person", 800, { destinationChangedAt: new Date(cycleDate.getTime() - 3 * DAY) })],
      ["P3", payee("P3", "Old Person", 900)],
      ["P4", payee("P4", "Maria Garcia", 800)],
      ["P5", payee("P5", "Maria Garcia", 700)],
      ["P6", payee("P6", "Aiko Tanaka", 700)],
    ]);

    const risky = pickRiskyLines({ plan: plan(lines), cycleDate, payeesById, recentDays: 30 });
    const byLine = Object.fromEntries(risky.map((r) => [r.line.lineId, r.reasons]));

    expect(byLine.L1).toEqual(["newPayee"]);
    expect(byLine.L2).toEqual(["recentPayee"]);
    expect(byLine.L3).toEqual(["destinationChanged"]);
    expect(byLine.L4).toBeUndefined();
    expect(byLine.L5).toEqual(["duplicateName"]);
    expect(byLine.L6).toEqual(["duplicateName"]);
    expect(byLine.L7).toBeUndefined(); // same payee twice is DUPLICATE_IN_BATCH, not ER
  });
});

describe("resolveEntityMatches", () => {
  const john = line({
    lineId: "LJOHN",
    payeeRef: "P-0118",
    payeeId: "P-0118",
    displayName: "John Doe",
    destination: { type: "EMAIL", value: "john.doe@example.com" },
  });
  const jon = line({
    lineId: "LJON",
    payeeRef: "P-0301",
    displayName: "Jon Doe",
    destination: { type: "EMAIL", value: "jon.doe.pay@example.net" },
  });
  const payeesById = new Map<string, ErPayee>([["P-0118", payee("P-0118", "John Doe", 900)]]);
  const historyByPayeeId = new Map([
    ["P-0118", [{ payeeId: "P-0118", destinationFingerprint: "fp", amountMinor: 2250, currency: "USD", paidAt: new Date("2026-09-28T12:00:00Z"), batchRef: "cycle-2026-09" }]],
  ]);

  it("flags the hero pair as CRITICAL ENTITY_MATCH with the §11.6 evidence keys", async () => {
    const queries: IdentityQuery[] = [];
    const flags = await resolveEntityMatches({
      plan: plan([john, jon]),
      cycleDate,
      payeesById,
      historyByPayeeId,
      policy: loadPolicy(),
      embeddings: fakeEmbeddings,
      search: async (query) => {
        queries.push(query);
        return [candidate({})];
      },
    });

    expect(queries).toHaveLength(1); // only Jon Doe is risky
    expect(queries[0]!.payeeId).toBeNull();

    expect(flags).toHaveLength(1);
    const flag = flags[0]!;
    expect(flag.lineId).toBe("LJON");
    expect(flag.ruleId).toBe("ENTITY_MATCH");
    expect(flag.severity).toBe("CRITICAL");
    expect(flag.blocking).toBe(true);
    expect(flag.relatedLineIds).toEqual(["LJOHN"]);

    const keys = flag.evidence.map((item) => item.key);
    for (const key of ["er.vector", "er.fuzzyName", "er.emailLocal", "er.sameDestination", "er.context.sameAmount", "er.score"]) {
      expect(keys).toContain(key);
    }
    const sameAmount = flag.evidence.find((item) => item.key === "er.context.sameAmount");
    expect(sameAmount?.value).toBe(true);
    const profile = flag.evidence.find((item) => item.key === "er.matchedProfile");
    expect(String(profile?.value)).toContain("900 days");
    expect(String(profile?.value)).toContain("1 payouts");
  });

  it("returns no flag when the best candidate scores below REVIEW", async () => {
    const flags = await resolveEntityMatches({
      plan: plan([john, jon]),
      cycleDate,
      payeesById,
      historyByPayeeId,
      embeddings: fakeEmbeddings,
      search: async () => [
        candidate({
          payeeId: "P-0900",
          nameRaw: "Priya Nair",
          nameNormalized: "priya nair",
          emailNormalized: "priya@example.org",
          emailLocalNormalized: "priya",
          vectorCos: 0.1,
        }),
      ],
    });
    expect(flags).toEqual([]);
  });

  it("does not flag two established payees with the same name unless they share a destination", async () => {
    const lines = [
      line({ lineId: "LA", payeeRef: "P4", payeeId: "P4", displayName: "Wei Chen" }),
      line({ lineId: "LB", payeeRef: "P5", payeeId: "P5", displayName: "Wei Chen" }),
    ];
    const payees = new Map([
      ["P4", payee("P4", "Wei Chen", 900, { country: "US" })],
      ["P5", payee("P5", "Wei Chen", 900, { country: "SG" })],
    ]);
    const flags = await resolveEntityMatches({
      plan: plan(lines),
      cycleDate,
      payeesById: payees,
      historyByPayeeId: new Map(),
      embeddings: fakeEmbeddings,
      search: async (query) =>
        query.payeeId === "P4"
          ? [candidate({ payeeId: "P5", nameRaw: "Wei Chen", nameNormalized: "wei chen", destinationFingerprint: "fp-P5", vectorCos: 1 })]
          : [candidate({ payeeId: "P4", nameRaw: "Wei Chen", nameNormalized: "wei chen", destinationFingerprint: "fp-P4", vectorCos: 1 })],
    });
    expect(flags).toEqual([]);
  });

  it("compares new payees in the same batch with each other", async () => {
    const a = line({ lineId: "LA", payeeRef: "N1", displayName: "Yusuf Demir", destination: { type: "EMAIL", value: "yusuf.demir@example.com" } });
    const b = line({ lineId: "LB", payeeRef: "N2", displayName: "Yusuf Demir", destination: { type: "EMAIL", value: "y.demir.pay@example.net" } });
    const flags = await resolveEntityMatches({
      plan: plan([a, b]),
      cycleDate,
      payeesById: new Map(),
      historyByPayeeId: new Map(),
      embeddings: { id: "same", dims: 1, embed: async (texts) => texts.map(() => [1]) },
      search: async () => [],
    });
    expect(flags.map((f) => f.lineId).sort()).toEqual(["LA", "LB"]);
    expect(flags[0]!.relatedLineIds.length).toBe(1);
  });

  it("excluded lines are ignored", async () => {
    const flags = await resolveEntityMatches({
      plan: plan([john, { ...jon, include: false }]),
      cycleDate,
      payeesById,
      historyByPayeeId,
      embeddings: fakeEmbeddings,
      search: async () => [candidate({})],
    });
    expect(flags).toEqual([]);
  });
});
