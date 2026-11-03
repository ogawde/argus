import { createHash } from "node:crypto";

/** Fixed root seed for the whole demo dataset. Change it and every number changes. */
export const DEMO_SEED = "argus-demo-v1";

export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** integer in [min, max] (inclusive) */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  /** returns a shuffled copy (Fisher-Yates) */
  shuffle<T>(items: readonly T[]): T[];
}

function seedFromString(text: string): number {
  const digest = createHash("sha256").update(text, "utf8").digest();
  return digest.readUInt32BE(0);
}

/** mulberry32: tiny, fast, good enough for fake data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One independent stream per label, so adding a new use of randomness
 * in one place doesn't shift numbers somewhere else.
 */
export function createRng(label: string): Rng {
  const raw = mulberry32(seedFromString(`${DEMO_SEED}:${label}`));

  const int = (min: number, max: number) => min + Math.floor(raw() * (max - min + 1));

  return {
    next: raw,
    int,
    pick: (items) => items[int(0, items.length - 1)]!,
    chance: (p) => raw() < p,
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(0, i);
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
  };
}
