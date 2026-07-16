import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("globals.css — ONB redesign motion + type-ramp utilities", () => {
  it("defines the panel-enter and message-enter motion utilities", () => {
    expect(css).toMatch(/@keyframes panel-enter/);
    expect(css).toMatch(/animation:\s*panel-enter 240ms ease-out/);
    expect(css).toMatch(/@keyframes message-enter/);
    expect(css).toMatch(/animation:\s*message-enter 180ms ease-out/);
  });

  it("disables both motion utilities under prefers-reduced-motion", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    const reducedMotionBlock = css.split("prefers-reduced-motion")[1];
    expect(reducedMotionBlock).toMatch(/\.panel-enter/);
    expect(reducedMotionBlock).toMatch(/\.message-enter/);
  });

  it("sets a text-2xl-equivalent floor for h1", () => {
    expect(css).toMatch(/h1\s*{[^}]*font-size:\s*1\.5rem/);
  });

  it("defines the opt-in amber radial glow flourish", () => {
    expect(css).toMatch(/\.amber-radial-glow/);
    expect(css).toMatch(/color-mix\(in srgb, var\(--color-amber\) 6%, transparent\)/);
  });

  it("V3A-B1: defines the checkpoint rail-sweep beat and disables it under reduced motion", () => {
    expect(css).toMatch(/@keyframes rail-sweep/);
    expect(css).toMatch(/\.rail-sweep\s*{\s*animation:\s*rail-sweep 600ms ease-in-out 1;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) {\s*\.rail-sweep {\s*animation: none;/);
  });
});
