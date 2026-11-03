/** Median of a non-empty number array (sorted copy). */
export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median of empty array");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Median absolute deviation. */
export function mad(values: number[], med = median(values)): number {
  if (values.length === 0) throw new Error("mad of empty array");
  return median(values.map((v) => Math.abs(v - med)));
}

/**
 * Robust z-score using MAD scale factor 1.4826.
 * When MAD is 0, falls back to absolute multiple-of-median check via Infinity if amount ≠ med.
 */
export function robustZ(amount: number, values: number[]): number {
  if (values.length === 0) return 0;
  const med = median(values);
  const m = mad(values, med);
  const scale = 1.4826 * m;
  if (scale === 0) {
    if (amount === med) return 0;
    return amount > med ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return (amount - med) / scale;
}

/** Approximate percentile (nearest-rank). p in [0, 100]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error("percentile of empty array");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[rank]!;
}
