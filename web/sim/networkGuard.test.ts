import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installNetworkGuard } from "./networkGuard";

describe("installNetworkGuard", () => {
  const trueOriginalFetch = globalThis.fetch;
  let stub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stub = vi.fn(async () => new Response("ok"));
    globalThis.fetch = stub as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = trueOriginalFetch;
  });

  it("blocks a non-Anthropic host and never calls through to the underlying fetch", () => {
    const guard = installNetworkGuard();
    expect(() => fetch("https://abcxyz.supabase.co/rest/v1/onboarding_sessions")).toThrow(/network guard/i);
    expect(stub).not.toHaveBeenCalled();
    guard.restore();
  });

  it("blocks a plain http host too (not just https)", () => {
    const guard = installNetworkGuard();
    expect(() => fetch("http://127.0.0.1:54321/rest/v1/profiles")).toThrow();
    expect(stub).not.toHaveBeenCalled();
    guard.restore();
  });

  it("allows api.anthropic.com through and counts the call", async () => {
    const guard = installNetworkGuard();
    await fetch("https://api.anthropic.com/v1/messages", { method: "POST" });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(guard.callCount()).toBe(1);
    guard.restore();
  });

  it("restore() puts the original fetch back in place", () => {
    const guard = installNetworkGuard();
    guard.restore();
    expect(globalThis.fetch).toBe(stub);
  });
});
