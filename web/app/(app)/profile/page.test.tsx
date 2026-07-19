import { describe, expect, it, vi, beforeEach } from "vitest";
import { deriveDossier } from "@/lib/dossier/derive";
import { renderDossierCopyBlock } from "@/lib/dossier/exportMarkdown";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const getUserMock = vi.fn();
const sessionQueryResult = { data: null as unknown, error: null as unknown };
const profilesQueryResult = { data: null as unknown, error: null as unknown };

function fakeSupabase() {
  const chain: Record<string, unknown> = { table: "" };
  const make = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) c[method] = () => c;
    c.maybeSingle = () =>
      Promise.resolve(table === "profiles" ? profilesQueryResult : sessionQueryResult);
    return c;
  };
  return { auth: { getUser: getUserMock }, from: (table: string) => make(table) };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeSupabase()),
}));

const { default: ProfilePage } = await import("./page");
const { DossierView } = await import("@/components/dossier/DossierView");

describe("/profile page", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getUserMock.mockReset();
    profilesQueryResult.data = null;
    profilesQueryResult.error = null;
    sessionQueryResult.data = null;
    sessionQueryResult.error = null;
  });

  it("redirects signed-out visitors to /login", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    await expect(ProfilePage()).rejects.toThrow("REDIRECT:/login");
  });

  it("warmly redirects to /onboarding when the user has no profiles row yet", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    profilesQueryResult.data = null;
    await expect(ProfilePage()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("derives and passes the dossier view model from profiles.doc + onboarding_sessions", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const doc = { "profile.yml": "identity:\n  name: Alex Quinn\n  email: alex@example.com\n" };
    const validation_status = { status: "valid", errors: [] };
    profilesQueryResult.data = { doc, validation_status };
    const modules = { anchor: { completed_at: "2026-07-10T10:00:00.000Z", receipt: "Alex Quinn" } };
    const extracted = { anchor: { current_title: "Staff RF Engineer" } };
    sessionQueryResult.data = { modules, extracted };

    const result = await ProfilePage();
    const view = result.props.children;
    expect(view.type).toBe(DossierView);
    const expectedDossier = deriveDossier({ doc, validationStatus: validation_status, modules, extracted });
    expect(view.props.dossier).toEqual(expectedDossier);
    expect(typeof view.props.copyBlock).toBe("string");
    expect(view.props.copyBlock.startsWith(renderDossierCopyBlock(expectedDossier, new Date()).slice(0, 40))).toBe(
      true
    );
  });

  it("treats a missing onboarding_sessions row as empty modules/extracted, not a crash", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const doc = { "profile.yml": "identity:\n  name: Alex Quinn\n  email: alex@example.com\n" };
    const validation_status = { status: "valid", errors: [] };
    profilesQueryResult.data = { doc, validation_status };
    sessionQueryResult.data = null;

    const result = await ProfilePage();
    const view = result.props.children;
    expect(view.props.dossier).toEqual(
      deriveDossier({ doc, validationStatus: validation_status, modules: {}, extracted: {} })
    );
  });
});
