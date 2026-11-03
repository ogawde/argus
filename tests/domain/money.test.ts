import { describe, expect, it } from "vitest";
import { assertMoney, toDecimalString } from "@/domain/money";

describe("money", () => {
  it("formats minor units as decimal strings", () => {
    expect(toDecimalString({ minor: 2250, currency: "USD" })).toBe("22.50");
    expect(toDecimalString({ minor: 5, currency: "USD" })).toBe("0.05");
    expect(toDecimalString({ minor: 100, currency: "USD" })).toBe("1.00");
  });

  it("rejects floats and negatives", () => {
    expect(() => assertMoney({ minor: 1.5 as unknown as number, currency: "USD" })).toThrow();
    expect(() => assertMoney({ minor: -1, currency: "USD" })).toThrow();
  });
});
