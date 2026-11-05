/** Small formatting helpers shared by the run dashboard widgets. */

export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minor / 100);
}

/** "+$12.00" / "−$3.50" (uses a real minus sign). */
export function formatSignedMoney(minor: number, currency: string): string {
  if (minor === 0) return formatMoney(0, currency);
  const text = formatMoney(Math.abs(minor), currency);
  return minor > 0 ? `+${text}` : `−${text}`;
}

/** Drops the "sha256:" prefix. */
export function hashHex(hash: string): string {
  return hash.replace(/^sha256:/, "");
}

/** "ad8dad68…04fa" */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  const hex = hashHex(hash);
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

/** First 8 hex characters. Used in the typed confirmations. */
export function hashPrefix(hash: string): string {
  return hashHex(hash).slice(0, 8);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
