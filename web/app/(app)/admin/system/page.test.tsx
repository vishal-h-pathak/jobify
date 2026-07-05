import { describe, expect, it, vi, beforeEach } from "vitest";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdmin: requireAdminMock }));

const { default: AdminSystemPage } = await import("./page");

describe("/admin/system page", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    requireAdminMock.mockReset();
  });

  it("redirects signed-out visitors to /login", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    await expect(AdminSystemPage()).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects non-admins to /feed", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "forbidden" });
    await expect(AdminSystemPage()).rejects.toThrow("REDIRECT:/feed");
  });
});
