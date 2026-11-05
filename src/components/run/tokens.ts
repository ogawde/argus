/**
 * Read a design token (CSS variable) from the page so canvas charts use the same colors as the CSS.
 * Only call this in the browser (the dashboard island is client-only).
 */
export function tokenColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
