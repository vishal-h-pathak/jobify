import { describe, expect, it, vi } from "vitest";
import { kitHref, setupHref, navigateToSetup } from "./links";

describe("kitHref", () => {
  it("builds the per-posting kit path", () => {
    expect(kitHref("posting-123")).toBe("/submit/posting-123");
  });
});

describe("setupHref", () => {
  it("with no returnTo, links to the bare setup route", () => {
    expect(setupHref()).toBe("/submit/setup");
  });

  it("encodes a returnTo path", () => {
    expect(setupHref("/submit/posting-123")).toBe("/submit/setup?returnTo=%2Fsubmit%2Fposting-123");
  });
});

describe("navigateToSetup", () => {
  it("navigates to setup with returnTo pointed back at this posting's kit", () => {
    const assignImpl = vi.fn();
    navigateToSetup("posting-123", assignImpl);
    expect(assignImpl).toHaveBeenCalledWith("/submit/setup?returnTo=%2Fsubmit%2Fposting-123");
  });
});
