import { createHash } from "node:crypto";

const HONORIFIC_OR_SUFFIX = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
]);

const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export interface NormalizedName {
  normalized: string;
  suffix: string | null;
}

/** Name: lowercase, NFKD + strip diacritics, drop punctuation, collapse space, peel honorifics/suffixes. */
export function normalizeName(raw: string): NormalizedName {
  const stripped = raw
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = stripped.split(" ").filter(Boolean);
  const suffixes: string[] = [];
  while (tokens.length && HONORIFIC_OR_SUFFIX.has(tokens[tokens.length - 1]!)) {
    suffixes.unshift(tokens.pop()!);
  }
  while (tokens.length && HONORIFIC_OR_SUFFIX.has(tokens[0]!)) {
    tokens.shift();
  }

  return {
    normalized: tokens.join(" "),
    suffix: suffixes.length ? suffixes.join(" ") : null,
  };
}

export interface NormalizedEmail {
  display: string;
  normalized: string;
  local: string;
  domain: string;
}

/** Email: lowercase; strip +tag; fold dots only for known dot-insensitive domains. */
export function normalizeEmail(raw: string): NormalizedEmail {
  const display = raw.trim();
  const lower = display.toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) {
    return { display, normalized: lower, local: lower, domain: "" };
  }
  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
  }
  return {
    display,
    normalized: `${local}@${domain}`,
    local,
    domain,
  };
}

export function destinationFingerprint(normalizedEmail: string): string {
  return createHash("sha256").update(normalizedEmail, "utf8").digest("hex");
}

export function identityText(args: {
  nameNormalized: string;
  emailLocalNormalized: string;
  country?: string | null;
}): string {
  return `${args.nameNormalized} | ${args.emailLocalNormalized} | ${args.country ?? ""}`;
}
