import Papa from "papaparse";
import type { Currency } from "./money";

export const CSV_COLUMNS = [
  "payee_ref",
  "name",
  "email",
  "amount",
  "currency",
  "note",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export interface CsvRowOk {
  ok: true;
  rowNumber: number;
  payeeRef: string;
  name: string;
  email: string;
  amountMinor: number;
  currency: Currency;
  note: string;
}

export interface CsvRowErr {
  ok: false;
  rowNumber: number;
  field: string;
  reason: string;
}

export type CsvRowResult = CsvRowOk | CsvRowErr;

export interface CsvParseResult {
  rows: CsvRowOk[];
  errors: CsvRowErr[];
  currency: Currency | null;
}

const FORMULA_PREFIX = /^[=+\-@]/;

function parseAmountMinor(raw: string): { ok: true; minor: number } | { ok: false; reason: string } {
  const s = raw.trim();
  if (!s) return { ok: false, reason: "amount is required" };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, reason: "amount must be numeric" };
  if (s.startsWith("-")) return { ok: false, reason: "amount must be positive" };
  const parts = s.split(".");
  if (parts[1] && parts[1].length > 2) {
    return { ok: false, reason: "amount may have at most 2 decimal places" };
  }
  const [whole, frac = ""] = parts;
  const minor = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    return { ok: false, reason: "amount must be a positive safe integer in minor units" };
  }
  return { ok: true, minor };
}

function rejectFormula(field: string, value: string): string | null {
  if (FORMULA_PREFIX.test(value.trim())) {
    return `${field} looks like a spreadsheet formula (rejected)`;
  }
  return null;
}

export function parseCsvText(
  text: string,
  opts: { maxRows: number; maxBytes: number },
): CsvParseResult {
  if (Buffer.byteLength(text, "utf8") > opts.maxBytes) {
    return {
      rows: [],
      errors: [
        {
          ok: false,
          rowNumber: 0,
          field: "file",
          reason: `file exceeds ${opts.maxBytes} bytes`,
        },
      ],
      currency: null,
    };
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const headerErrors: CsvRowErr[] = [];
  const fields = parsed.meta.fields ?? [];
  for (const col of CSV_COLUMNS) {
    if (!fields.includes(col)) {
      headerErrors.push({
        ok: false,
        rowNumber: 0,
        field: col,
        reason: `missing required column ${col}`,
      });
    }
  }
  if (headerErrors.length) {
    return { rows: [], errors: headerErrors, currency: null };
  }

  if (parsed.data.length > opts.maxRows) {
    return {
      rows: [],
      errors: [
        {
          ok: false,
          rowNumber: 0,
          field: "file",
          reason: `row count ${parsed.data.length} exceeds cap ${opts.maxRows}`,
        },
      ],
      currency: null,
    };
  }

  const rows: CsvRowOk[] = [];
  const errors: CsvRowErr[] = [];
  let currency: Currency | null = null;

  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 2; // header is row 1
    const pushErr = (field: string, reason: string) => {
      errors.push({ ok: false, rowNumber, field, reason });
    };

    const payeeRef = (raw.payee_ref ?? "").trim();
    const name = (raw.name ?? "").trim();
    const email = (raw.email ?? "").trim();
    const amountRaw = (raw.amount ?? "").trim();
    const currencyRaw = (raw.currency ?? "").trim().toUpperCase();
    const note = (raw.note ?? "").trim();

    for (const [field, value] of [
      ["payee_ref", payeeRef],
      ["name", name],
      ["email", email],
      ["note", note],
    ] as const) {
      const bad = rejectFormula(field, value);
      if (bad) pushErr(field, bad);
    }

    if (!payeeRef) pushErr("payee_ref", "required");
    if (!name) pushErr("name", "required");
    if (!email) pushErr("email", "required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      pushErr("email", "invalid email");
    }

    const amt = parseAmountMinor(amountRaw);
    if (!amt.ok) pushErr("amount", amt.reason);

    if (currencyRaw !== "USD" && currencyRaw !== "EUR" && currencyRaw !== "GBP") {
      pushErr("currency", "must be USD, EUR, or GBP");
    } else if (currency === null) {
      currency = currencyRaw;
    } else if (currency !== currencyRaw) {
      pushErr("currency", `mixed currencies not allowed (batch is ${currency})`);
    }

    if (note.length > 200) pushErr("note", "max 200 characters");

    if (errors.some((e) => e.rowNumber === rowNumber)) return;

    rows.push({
      ok: true,
      rowNumber,
      payeeRef,
      name,
      email,
      amountMinor: (amt as { ok: true; minor: number }).minor,
      currency: currencyRaw as Currency,
      note,
    });
  });

  return { rows, errors, currency };
}
