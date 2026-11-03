export type Currency = "USD" | "EUR" | "GBP";

export interface Money {
  minor: number;
  currency: Currency;
}

/** Convert integer minor units to a PayPal decimal string. Domain boundary only. */
export function toDecimalString(m: Money): string {
  if (!Number.isSafeInteger(m.minor) || m.minor < 0) {
    throw new Error("amountMinor must be a non-negative safe integer");
  }
  return `${Math.trunc(m.minor / 100)}.${String(m.minor % 100).padStart(2, "0")}`;
}

export function assertMoney(m: Money): void {
  if (!Number.isSafeInteger(m.minor) || m.minor < 0) {
    throw new Error("amountMinor must be a non-negative safe integer");
  }
  if (m.currency !== "USD" && m.currency !== "EUR" && m.currency !== "GBP") {
    throw new Error(`unsupported currency: ${m.currency}`);
  }
}
