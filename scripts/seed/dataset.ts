import { destinationFingerprint, normalizeEmail } from "../../src/domain/normalize";
import { COUNTRIES, EMAIL_DOMAINS, FIRST_NAMES, LAST_NAMES } from "./names";
import { createRng } from "./prng";

/**
 * Pure dataset builder for BRIEF §9. No DB, no file IO, no clock.
 * Same cycle date in => byte-identical dataset out.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const HISTORY_CYCLES = 12;
export const PAYEE_COUNT = 300;
export const BATCH_LINE_COUNT = 300;
export const CSV_HEADER = "payee_ref,name,email,amount,currency,note";

/** Oldest cycle first (cycle 0 = 12 months before the October cycle). */
const MONTH_FACTORS = [
  0.8, 1.0, 1.25, 1.4, 1.05, 1.3, 1.45, 0.9, 1.15, 1.35, 0.95, 1.2,
] as const;

export interface PayeeSeed {
  id: string;
  legalName: string;
  displayName: string;
  country: string | null;
  destinationValue: string;
  destinationFingerprint: string;
  createdAt: Date;
  destinationChangedAt: Date | null;
  sandboxRemap: boolean;
  version: number;
}

export interface HistorySeed {
  id: string;
  payeeId: string;
  destinationFingerprint: string;
  amountMinor: number;
  currency: "USD";
  paidAt: Date;
  batchRef: string;
}

export interface BatchRowSeed {
  payeeRef: string;
  name: string;
  email: string;
  amountMinor: number;
  note: string;
}

export interface DemoDataset {
  cycleDate: Date;
  payees: PayeeSeed[];
  history: HistorySeed[];
  batchRows: BatchRowSeed[];
  csvText: string;
  /** scenario → payee ref / name, handy for the verifier */
  scenarios: Record<string, { payeeRef: string; name: string }>;
}

type HistoryPattern = "seasonal" | "steady" | "flat";

interface PayeeSpec {
  id: string;
  name: string;
  legalName?: string;
  country: string | null;
  /** email stored in the Payee master */
  email: string;
  /** email on the October CSV row, if different from master (S2) */
  csvEmail?: string;
  baseMinor: number;
  octMinor?: number;
  pattern?: HistoryPattern;
  /** exact history instead of generated one: [cycleIndex, amountMinor] */
  explicitHistory?: Array<[number, number]>;
  /** extra off-cycle payouts: [daysBeforeCycle, amountMinor] */
  extras?: Array<[number, number]>;
  createdDaysBefore?: number;
  /** master email changed long ago; older history uses the previous email */
  oldEmail?: { email: string; changedDaysBefore: number };
  /** master still has the old email, change recorded this many hours before the cycle */
  pendingChangeHoursBefore?: number;
  sandboxRemap?: boolean;
  omitFromBatch?: boolean;
  listTwice?: boolean;
  canSkipMonths?: boolean;
}

interface NewPayeeSpec {
  ref: string;
  name: string;
  email: string;
  amountMinor: number;
  note: string;
}

// ---- small helpers -------------------------------------------------------

function round(minor: number, step: number): number {
  return Math.round(minor / step) * step;
}

export function formatAmount(minor: number): string {
  return `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function fingerprintOf(email: string): string {
  return destinationFingerprint(normalizeEmail(email).normalized);
}

function payeeId(n: number): string {
  return `P-${String(n).padStart(4, "0")}`;
}

function emailFor(first: string, last: string, domain: string): string {
  return `${first}.${last}@${domain}`.toLowerCase();
}

/** Same day-of-month each cycle (clamped to 28), paid at noon UTC. */
function cyclePaidAt(cycleDate: Date, monthsBack: number): Date {
  const day = Math.min(cycleDate.getUTCDate(), 28);
  return new Date(
    Date.UTC(cycleDate.getUTCFullYear(), cycleDate.getUTCMonth() - monthsBack, day, 12, 0, 0),
  );
}

function batchRefFor(paidAt: Date): string {
  return `cycle-${paidAt.toISOString().slice(0, 7)}`;
}

function daysBefore(cycleDate: Date, days: number, hour = 0): Date {
  return new Date(cycleDate.getTime() - days * DAY_MS + hour * HOUR_MS);
}

// ---- scenario + hard-negative payees (fixed ids) ------------------------

const SCENARIO_PAYEES: PayeeSpec[] = [
  // S1 hero: established John Doe, paid exactly $22.50 every month
  {
    id: "P-0118", name: "John Doe", country: "US", email: "john.doe@example.com",
    baseMinor: 2250, pattern: "flat", createdDaysBefore: 900,
  },
  // hard negative for S1
  {
    id: "P-0119", name: "Jane Doe", country: "US", email: "jane.doe@example.net",
    baseMinor: 1400, createdDaysBefore: 800,
  },
  // S2 destination swap: master keeps the old email, change logged ~2 days before cycle
  {
    id: "P-0042", name: "Priya Nair", country: "IN", email: "priya.nair@example.com",
    csvEmail: "priya.nair.work@example.net", baseMinor: 1000, createdDaysBefore: 700,
    pendingChangeHoursBefore: 57,
  },
  // S3 fat-finger: usually $45, October row says $450
  {
    id: "P-0064", name: "Carlos Mendes", country: "MX", email: "carlos.mendes@example.org",
    baseMinor: 4500, octMinor: 45000, pattern: "steady", createdDaysBefore: 850,
  },
  // S4 duplicate row
  {
    id: "P-0075", name: "Aiko Tanaka", country: "JP", email: "aiko.tanaka@example.com",
    baseMinor: 1100, createdDaysBefore: 760, listTwice: true,
  },
  // S5 velocity: 4 extra payouts in the 9 days before the cycle, all different from the October amount
  {
    id: "P-0097", name: "Ravi Menon", country: "IN", email: "ravi.menon@example.net",
    baseMinor: 1200, createdDaysBefore: 640,
    extras: [[8, 1750], [6, 600], [3, 900], [1, 1500]],
  },
  // S6 shared destination: two payees, one inbox
  {
    id: "P-0088", name: "Northwind Studio", legalName: "Northwind Studio LLC", country: "US",
    email: "payments@northwind.example.com", baseMinor: 1800, createdDaysBefore: 880,
  },
  {
    id: "P-0089", name: "Lena Fischer", country: "DE", email: "payments@northwind.example.com",
    baseMinor: 950, createdDaysBefore: 560,
  },
  // S8 dormant: only paid in the first two cycles, idle ~11 months, $12 is inside her norm
  {
    id: "P-0131", name: "Greta Lindqvist", country: "SE", email: "greta.lindqvist@example.org",
    baseMinor: 1200, createdDaysBefore: 900, explicitHistory: [[0, 1150], [1, 1250]],
  },
  // S9 established look-alike of "Muhammad Alrashid"
  {
    id: "P-0220", name: "Mohammed Al-Rashid", country: "AE", email: "mohammed.alrashid@example.com",
    baseMinor: 1400, createdDaysBefore: 780,
  },
  // U1: clean, established, email is not a registered sandbox account
  {
    id: "P-0207", name: "Nadia Okafor", country: "NG", email: "nadia.okafor@example.net",
    baseMinor: 1050, createdDaysBefore: 690, sandboxRemap: false,
  },
  // hard negatives: same name, different people
  {
    id: "P-0150", name: "Wei Chen", country: "US", email: "wei.chen@example.com",
    baseMinor: 1100, createdDaysBefore: 950,
  },
  {
    id: "P-0151", name: "Wei Chen", country: "SG", email: "wei.chen@example.org",
    baseMinor: 2600, createdDaysBefore: 920,
  },
  {
    id: "P-0160", name: "Robert Chen Sr.", country: "CA", email: "robert.chen.sr@example.com",
    baseMinor: 1650, createdDaysBefore: 870,
  },
  {
    id: "P-0161", name: "Robert Chen Jr.", country: "CA", email: "robert.chen.jr@example.com",
    baseMinor: 850, createdDaysBefore: 610,
  },
  {
    id: "P-0170", name: "Maria Garcia", country: "ES", email: "maria.garcia@example.com",
    baseMinor: 1300, createdDaysBefore: 830,
  },
  {
    id: "P-0171", name: "Maria Garcia", country: "MX", email: "maria.garcia@example.net",
    baseMinor: 2050, createdDaysBefore: 790,
  },
  {
    id: "P-0180", name: "Sam Taylor", country: "GB", email: "sam.taylor@example.org",
    baseMinor: 975, createdDaysBefore: 740,
  },
  {
    id: "P-0181", name: "Samantha Taylor", country: "GB", email: "samantha.taylor@example.org",
    baseMinor: 1575, createdDaysBefore: 720,
  },
  {
    id: "P-0190", name: "Anil Kumar", country: "IN", email: "anil.kumar@example.com",
    baseMinor: 1125, createdDaysBefore: 810,
  },
  {
    id: "P-0191", name: "Anita Kumar", country: "IN", email: "anita.kumar@example.com",
    baseMinor: 1850, createdDaysBefore: 770,
  },
];

// The three brand-new payees in the October batch (not in Payee master or history).
const NEW_PAYEES: NewPayeeSpec[] = [
  { ref: "P-0301", name: "Jon Doe", email: "jon.doe.pay@example.net", amountMinor: 2250, note: "October creator payout" },
  { ref: "P-0302", name: "Orbit Labs LLC", email: "accounts@orbitlabs.example.com", amountMinor: 30000, note: "October vendor payout" },
  { ref: "P-0303", name: "Muhammad Alrashid", email: "m.alrashid@example.net", amountMinor: 1400, note: "October creator payout" },
];

// ---- filler payees --------------------------------------------------------

function buildFillerSpecs(count: number, takenIds: Set<string>): PayeeSpec[] {
  const rng = createRng("fillers");
  const used = new Set<string>();
  const lastNameUse = new Map<string, string[]>(); // surname -> first initials used
  const pairs: Array<[string, string]> = [];

  while (pairs.length < count) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const initials = lastNameUse.get(last) ?? [];
    if (used.has(`${first} ${last}`)) continue;
    if (initials.length >= 3 || initials.includes(first[0]!)) continue;
    used.add(`${first} ${last}`);
    lastNameUse.set(last, [...initials, first[0]!]);
    pairs.push([first, last]);
  }

  const freeIds: string[] = [];
  for (let n = 1; n <= PAYEE_COUNT; n++) {
    if (!takenIds.has(payeeId(n))) freeIds.push(payeeId(n));
  }

  const specs: PayeeSpec[] = pairs.map(([first, last], i) => {
    // mostly small payouts, a few bigger creators
    const isBig = rng.chance(0.06);
    const raw = isBig ? 1500 + rng.next() * 1500 : 400 + Math.pow(rng.next(), 2) * 1100;
    return {
      id: freeIds[i]!,
      name: `${first} ${last}`,
      country: rng.pick(COUNTRIES),
      email: emailFor(first, last, rng.pick(EMAIL_DOMAINS)),
      baseMinor: round(raw, 25),
      createdDaysBefore: rng.int(400, 1100),
      canSkipMonths: true,
    };
  });

  // 5 fillers changed their email long ago (history before that uses the old one) — all clean
  for (const i of rng.shuffle(specs.map((_, idx) => idx)).slice(0, 5)) {
    const spec = specs[i]!;
    const [local, domain] = spec.email.split("@") as [string, string];
    spec.oldEmail = { email: `${local}.legacy@${domain}`, changedDaysBefore: rng.int(60, 300) };
  }

  // 4 fillers are simply not in the October batch (300 lines = 296 established + dup + 3 new)
  const candidates = specs.filter((s) => !s.oldEmail);
  for (const s of rng.shuffle(candidates).slice(0, 4)) s.omitFromBatch = true;

  return specs;
}

// ---- main builder ---------------------------------------------------------

export function buildDemoDataset(cycleDate: Date): DemoDataset {
  const takenIds = new Set(SCENARIO_PAYEES.map((s) => s.id));
  const fillerCount = PAYEE_COUNT - SCENARIO_PAYEES.length;
  const specs = [...SCENARIO_PAYEES, ...buildFillerSpecs(fillerCount, takenIds)].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const payees: PayeeSeed[] = [];
  const history: HistorySeed[] = [];

  for (const spec of specs) {
    const masterEmail = normalizeEmail(spec.email).normalized;
    const masterFp = fingerprintOf(spec.email);
    const changedAt = spec.oldEmail
      ? daysBefore(cycleDate, spec.oldEmail.changedDaysBefore)
      : spec.pendingChangeHoursBefore
        ? new Date(cycleDate.getTime() - spec.pendingChangeHoursBefore * HOUR_MS)
        : null;

    payees.push({
      id: spec.id,
      legalName: spec.legalName ?? spec.name,
      displayName: spec.name,
      country: spec.country,
      destinationValue: masterEmail,
      destinationFingerprint: masterFp,
      createdAt: daysBefore(cycleDate, spec.createdDaysBefore ?? 600),
      destinationChangedAt: changedAt,
      sandboxRemap: spec.sandboxRemap ?? true,
      version: 1,
    });

    const rng = createRng(`history:${spec.id}`);
    const pattern = spec.pattern ?? "seasonal";
    const oldFp = spec.oldEmail ? fingerprintOf(spec.oldEmail.email) : masterFp;

    const pushHistory = (paidAt: Date, amountMinor: number, batchRef: string) => {
      const useOld = spec.oldEmail && changedAt && paidAt < changedAt;
      history.push({
        id: `${spec.id}:${batchRef}`,
        payeeId: spec.id,
        destinationFingerprint: useOld ? oldFp : masterFp,
        amountMinor,
        currency: "USD",
        paidAt,
        batchRef,
      });
    };

    if (spec.explicitHistory) {
      for (const [idx, minor] of spec.explicitHistory) {
        const paidAt = cyclePaidAt(cycleDate, HISTORY_CYCLES - idx);
        pushHistory(paidAt, minor, batchRefFor(paidAt));
      }
    } else {
      for (let idx = 0; idx < HISTORY_CYCLES; idx++) {
        // never skip the latest cycle, so nobody drifts into "dormant" by accident
        const skipped = spec.canSkipMonths && idx < HISTORY_CYCLES - 1 && rng.chance(0.03);
        const jitter = 1 + (rng.next() - 0.5) * (pattern === "steady" ? 0.1 : 0.14);
        if (skipped) continue;

        let minor = spec.baseMinor;
        if (pattern === "seasonal") minor = round(spec.baseMinor * MONTH_FACTORS[idx]! * jitter, 5);
        if (pattern === "steady") minor = round(spec.baseMinor * jitter, 5);

        const paidAt = cyclePaidAt(cycleDate, HISTORY_CYCLES - idx);
        pushHistory(paidAt, Math.max(minor, 100), batchRefFor(paidAt));
      }
    }

    for (const [days, minor] of spec.extras ?? []) {
      const paidAt = daysBefore(cycleDate, days, 12);
      pushHistory(paidAt, minor, `adhoc-${paidAt.toISOString().slice(0, 10)}`);
    }
  }

  // ---- October batch ----
  const rows: BatchRowSeed[] = [];
  for (const spec of specs) {
    if (spec.omitFromBatch) continue;
    const row: BatchRowSeed = {
      payeeRef: spec.id,
      name: spec.name,
      email: spec.csvEmail ?? spec.email,
      amountMinor: spec.octMinor ?? spec.baseMinor,
      note: "October creator payout",
    };
    rows.push(row);
    if (spec.listTwice) rows.push({ ...row });
  }
  for (const n of NEW_PAYEES) {
    rows.push({ payeeRef: n.ref, name: n.name, email: n.email, amountMinor: n.amountMinor, note: n.note });
  }

  const batchRows = createRng("csv-order").shuffle(rows);

  const csvLines = batchRows.map((r) =>
    [r.payeeRef, r.name, r.email, formatAmount(r.amountMinor), "USD", r.note].map(csvEscape).join(","),
  );
  const csvText = [CSV_HEADER, ...csvLines].join("\n") + "\n";

  const scenarios: DemoDataset["scenarios"] = {
    S1: { payeeRef: "P-0301", name: "Jon Doe" },
    S1_established: { payeeRef: "P-0118", name: "John Doe" },
    S2: { payeeRef: "P-0042", name: "Priya Nair" },
    S3: { payeeRef: "P-0064", name: "Carlos Mendes" },
    S4: { payeeRef: "P-0075", name: "Aiko Tanaka" },
    S5: { payeeRef: "P-0097", name: "Ravi Menon" },
    S6a: { payeeRef: "P-0088", name: "Northwind Studio" },
    S6b: { payeeRef: "P-0089", name: "Lena Fischer" },
    S7: { payeeRef: "P-0302", name: "Orbit Labs LLC" },
    S8: { payeeRef: "P-0131", name: "Greta Lindqvist" },
    S9: { payeeRef: "P-0303", name: "Muhammad Alrashid" },
    S9_established: { payeeRef: "P-0220", name: "Mohammed Al-Rashid" },
    U1: { payeeRef: "P-0207", name: "Nadia Okafor" },
  };

  return { cycleDate, payees, history, batchRows, csvText, scenarios };
}
