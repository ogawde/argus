import type { EvidenceItem } from "@/domain/studio-data";
import { formatDateTime, formatMoney } from "@/components/run/format";

/** Keys shown as similarity bars (entity resolution). */
export const ER_BAR_KEYS = [
  "er.vector",
  "er.fuzzyName",
  "er.emailLocal",
  "er.sameDestination",
  "er.context.sameAmount",
] as const;

/** Keys that are rendered by a dedicated widget, so the plain list skips them. */
const HIDDEN_FROM_LIST = new Set<string>([...ER_BAR_KEYS, "er.matchedProfile"]);

export function evidenceValue(items: EvidenceItem[], key: string): EvidenceItem["value"] | undefined {
  return items.find((item) => item.key === key)?.value;
}

/** Evidence rows for the plain key/value list. */
export function listableEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter((item) => !HIDDEN_FROM_LIST.has(item.key));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Make one evidence value readable: minor units become money, ISO dates become dates. */
export function formatEvidenceValue(item: EvidenceItem, currency: string): string {
  const { key, value } = item;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && /minor$/i.test(key)) return formatMoney(value, currency);
  if (typeof value === "string" && ISO_DATE.test(value)) return formatDateTime(value);
  return String(value);
}
