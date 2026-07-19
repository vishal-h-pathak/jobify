/**
 * A tiny deterministic PRNG so the RECOVERY invariant's "2-3
 * random-but-seeded points" (session-prompt 45, task 3) are reproducible
 * across runs — a sim that flakes differently every time it's re-run
 * defeats the point of a regression harness. `Math.random()` is
 * deliberately never used here.
 */

function hashStringToSeed(seedString: string): number {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seedString.length; i++) {
    hash ^= seedString.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic `() => number` in [0, 1), seeded from an arbitrary string. */
export function createSeededRng(seedString: string): () => number {
  return mulberry32(hashStringToSeed(seedString));
}

/**
 * Picks `count` distinct integers in `[minInclusive, maxInclusive]`,
 * deterministically from `seedString`, sorted ascending. Caps at the size
 * of the available range rather than looping forever when `count` exceeds
 * it; returns `[]` for an empty or inverted range.
 */
export function pickSeededPoints(
  seedString: string,
  count: number,
  minInclusive: number,
  maxInclusive: number
): number[] {
  const range = maxInclusive - minInclusive + 1;
  if (range <= 0) return [];

  const rng = createSeededRng(seedString);
  const points = new Set<number>();
  const target = Math.min(count, range);
  let guard = 0;
  while (points.size < target && guard < 10_000) {
    points.add(minInclusive + Math.floor(rng() * range));
    guard++;
  }
  return [...points].sort((a, b) => a - b);
}
