import { describe, expect, it } from "vitest";
import { createSeededRng, pickSeededPoints } from "./seededRandom";

describe("createSeededRng", () => {
  it("is deterministic — the same seed string produces the same sequence", () => {
    const a = createSeededRng("cooperative-recovery");
    const b = createSeededRng("cooperative-recovery");
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("different seed strings produce different sequences", () => {
    const a = createSeededRng("cooperative-recovery");
    const b = createSeededRng("terse-recovery");
    expect(a()).not.toBe(b());
  });

  it("produces values in [0, 1)", () => {
    const rng = createSeededRng("range-check");
    for (let i = 0; i < 50; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("pickSeededPoints", () => {
  it("is deterministic for the same seed string", () => {
    const a = pickSeededPoints("cooperative", 3, 2, 20);
    const b = pickSeededPoints("cooperative", 3, 2, 20);
    expect(a).toEqual(b);
  });

  it("returns the requested count of distinct, sorted, in-range points", () => {
    const points = pickSeededPoints("terse", 3, 2, 20);
    expect(points).toHaveLength(3);
    expect(new Set(points).size).toBe(3);
    expect([...points].sort((x, y) => x - y)).toEqual(points);
    for (const p of points) {
      expect(p).toBeGreaterThanOrEqual(2);
      expect(p).toBeLessThanOrEqual(20);
    }
  });

  it("caps the count at the size of the available range instead of looping forever", () => {
    const points = pickSeededPoints("meandering", 10, 5, 6);
    expect(points.length).toBeLessThanOrEqual(2);
  });

  it("returns an empty array for an empty or inverted range", () => {
    expect(pickSeededPoints("x", 3, 10, 5)).toEqual([]);
  });
});
