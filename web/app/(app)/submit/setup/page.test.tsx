import { describe, expect, it, vi } from "vitest";
import { navigateAfterSave } from "./page";

describe("navigateAfterSave", () => {
  it("navigates to the resolved returnTo target", () => {
    const assignImpl = vi.fn();
    navigateAfterSave("/submit/posting-123", assignImpl);
    expect(assignImpl).toHaveBeenCalledWith("/submit/posting-123");
  });

  it("falls back to /settings when returnTo is absent", () => {
    const assignImpl = vi.fn();
    navigateAfterSave(null, assignImpl);
    expect(assignImpl).toHaveBeenCalledWith("/settings");
  });

  it("falls back to /settings for an open-redirect attempt", () => {
    const assignImpl = vi.fn();
    navigateAfterSave("//evil.example.com", assignImpl);
    expect(assignImpl).toHaveBeenCalledWith("/settings");
  });
});
