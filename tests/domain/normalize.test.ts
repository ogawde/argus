import { describe, expect, it } from "vitest";
import { destinationFingerprint, normalizeEmail, normalizeName } from "@/domain/normalize";

describe("normalizeName", () => {
  it("lowercases and strips accents and punctuation", () => {
    expect(normalizeName("  José  O'Brien ").normalized).toBe("jose o brien");
  });

  it("peels honorifics and suffixes", () => {
    const result = normalizeName("Dr. Jane Smith Jr.");
    expect(result.normalized).toBe("jane smith");
    expect(result.suffix).toBe("jr");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and strips +tags", () => {
    expect(normalizeEmail("Jane+promo@Example.com").normalized).toBe("jane@example.com");
  });

  it("folds dots only for gmail", () => {
    expect(normalizeEmail("j.a.n.e@gmail.com").normalized).toBe("jane@gmail.com");
    expect(normalizeEmail("j.a.n.e@example.com").normalized).toBe("j.a.n.e@example.com");
  });

  it("gives the same fingerprint for equivalent addresses", () => {
    const a = normalizeEmail("Jane+x@example.com").normalized;
    const b = normalizeEmail("jane@example.com").normalized;
    expect(destinationFingerprint(a)).toBe(destinationFingerprint(b));
  });
});
