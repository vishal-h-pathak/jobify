import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canFireAppliedClick, handleAppliedClick, shouldRedirectToSetup } from "./SubmitKit";

describe("handleAppliedClick", () => {
  it("calls markApplied with the given supabase client, user, and posting — the feed's own mechanism", async () => {
    const markAppliedImpl = vi.fn().mockResolvedValue(undefined);
    const fakeSupabase = {} as never;
    const result = await handleAppliedClick(fakeSupabase, "user-1", "posting-1", markAppliedImpl);
    expect(result).toEqual({ ok: true });
    expect(markAppliedImpl).toHaveBeenCalledWith(fakeSupabase, "user-1", "posting-1");
  });

  it("surfaces a thrown error's message instead of marking applied", async () => {
    const markAppliedImpl = vi.fn().mockRejectedValue(new Error("RLS policy regression?"));
    const result = await handleAppliedClick({} as never, "user-1", "posting-1", markAppliedImpl);
    expect(result).toEqual({ ok: false, error: "RLS policy regression?" });
  });
});

describe("canFireAppliedClick — UX1-B paper cut 2: in-flight guard", () => {
  it("allows the click when no call is already pending", () => {
    expect(canFireAppliedClick(false)).toBe(true);
  });

  it("blocks a second click while the markApplied call is still in flight — no double-fire", () => {
    expect(canFireAppliedClick(true)).toBe(false);
  });
});

describe("shouldRedirectToSetup", () => {
  it("a 409 (needs_setup) outcome triggers the redirect to setup", () => {
    expect(shouldRedirectToSetup({ kind: "needs_setup" })).toBe(true);
  });

  it("a ready, no_materials, or error outcome does not redirect", () => {
    expect(shouldRedirectToSetup({ kind: "no_materials" })).toBe(false);
    expect(shouldRedirectToSetup({ kind: "error", message: "boom" })).toBe(false);
    expect(shouldRedirectToSetup(null)).toBe(false);
  });
});

describe("print stylesheet", () => {
  it("globals.css defines print rules scoped to the kit's printable region", () => {
    const css = readFileSync(path.join(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toContain("@media print");
    expect(css).toContain(".submit-kit-print");
  });
});
