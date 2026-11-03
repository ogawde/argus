import { describe, expect, it } from "vitest";
import { parseCsvText } from "@/domain/csv";

const opts = { maxRows: 100, maxBytes: 100_000 };
const header = "payee_ref,name,email,amount,currency,note\n";

describe("parseCsvText", () => {
  it("parses a good row into minor units", () => {
    const result = parseCsvText(`${header}P-1,Alice,a@example.com,12.5,usd,hello\n`, opts);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ payeeRef: "P-1", amountMinor: 1250, currency: "USD" });
  });

  it.each(["=SUM(A1)", "+1", "-1", "@cmd"])("rejects formula-looking note %s", (note) => {
    const result = parseCsvText(`${header}P-1,Alice,a@example.com,5.00,USD,"${note}"\n`, opts);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.some((e) => e.field === "note")).toBe(true);
  });

  it("rejects a formula in the name", () => {
    const result = parseCsvText(`${header}P-1,=HYPERLINK("x"),a@example.com,5.00,USD,\n`, opts);
    expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("reports missing columns", () => {
    const result = parseCsvText("payee_ref,name\nP-1,Alice\n", opts);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.map((e) => e.field)).toContain("amount");
  });

  it("rejects bad amounts, emails and currencies", () => {
    const text = [
      header.trim(),
      "P-1,Alice,not-an-email,5.00,USD,",
      "P-2,Bob,b@example.com,abc,USD,",
      "P-3,Cy,c@example.com,5.001,USD,",
      "P-4,Di,d@example.com,5.00,JPY,",
    ].join("\n");
    const result = parseCsvText(text, opts);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.map((e) => e.field).sort()).toEqual(["amount", "amount", "currency", "email"]);
  });

  it("rejects mixed currencies", () => {
    const text = `${header}P-1,Alice,a@example.com,5.00,USD,\nP-2,Bob,b@example.com,5.00,EUR,\n`;
    const result = parseCsvText(text, opts);
    expect(result.rows).toHaveLength(1);
    expect(result.errors[0]?.reason).toMatch(/mixed currencies/);
  });

  it("enforces row and byte caps", () => {
    const rows = `${header}P-1,A,a@example.com,1.00,USD,\nP-2,B,b@example.com,1.00,USD,\n`;
    expect(parseCsvText(rows, { maxRows: 1, maxBytes: 100_000 }).errors[0]?.reason).toMatch(/exceeds cap/);
    expect(parseCsvText(rows, { maxRows: 10, maxBytes: 10 }).errors[0]?.reason).toMatch(/exceeds/);
  });
});
