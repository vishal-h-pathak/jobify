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
});
