import { describe, expect, it, vi, beforeEach } from "vitest";
import { VALUE_PAIRS } from "@/lib/onboarding/moduleWriters/values";

/**
 * Task 0 (mandatory, wave-2 review debt): every existing per-route test
 * mocks `moduleRegistry.ts` / `checkpoint.ts` away, so no test has ever
 * exercised the real completion-sequence logic (markModuleComplete ->
 * phaseOneComplete -> maybeFireCheckpoint) across all four real phase-1
 * route handlers together. This file drives the four real routes with
 * fakes only at the DB/dispatch boundary — moduleRegistry.ts,
 * checkpoint.ts, and incrementalDoc.ts all run for real.
 */

const USER = { id: "user-1" };

// Fictional seed postings — no real company/person names (scrub gate).
const POSTINGS = Array.from({ length: 6 }, (_, i) => ({
  id: `posting-${i + 1}`,
  title: "Staff Engineer",
  company: "Acme",
}));

// ── generic thenable chain helper (per brief) ──────────────────────────────
// Every chain method returns the same object; the object is itself
// thenable (resolves to `result`) and also exposes `maybeSingle`.
function chain(result: { data?: unknown; error: unknown }) {
  const obj: Record<string, unknown> = { ...result };
  for (const method of ["select", "eq", "neq", "gte", "order", "limit", "upsert", "update"]) {
    obj[method] = () => obj;
  }
  obj.maybeSingle = async () => result;
  obj.then = (resolve: (value: unknown) => void) => resolve(result);
  return obj;
}

// ── fake @/lib/supabase/server client ───────────────────────────────────────
// Covers exactly what reactions/route.ts's POST path calls:
// .from("postings").select(...).eq("id", id).maybeSingle() (looked up from
// the seeded in-memory POSTINGS array) and
// .from("posting_reactions").upsert(...) (no-op success).
function makeServerClient() {
  return {
    auth: { getUser: async () => ({ data: { user: USER } }) },
    from(table: string) {
      if (table === "postings") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => {
              const posting = POSTINGS.find((p) => p.id === id) ?? null;
              return chain({ data: posting, error: null });
            },
          }),
        };
      }
      if (table === "posting_reactions") {
        return chain({ error: null });
      }
      throw new Error(`fake server client: unexpected table "${table}"`);
    },
  };
}

// ── fake @/lib/supabase/admin client ────────────────────────────────────────
// This is what checkpoint.ts's maybeFireCheckpoint calls directly on
// deps.admin. `profiles` is stateful (tracks the upsert) so the checkpoint's
// own layer-2 idempotency guard (a fresh existence check against current DB
// state) behaves the way it does against real Postgres — otherwise a redo
// POST after phase 1 completes would re-fire the hunt, since the session
// object each route re-reads never itself round-trips through this admin
// write.
function makeAdminClient() {
  let profilesRow: Record<string, unknown> | null = null;
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: profilesRow ? { user_id: profilesRow.user_id } : null,
                error: null,
              }),
            }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            profilesRow = row;
            return { error: null };
          },
        };
      }
      if (table === "onboarding_sessions") {
        return chain({ error: null });
      }
      throw new Error(`fake admin client: unexpected table "${table}"`);
    },
  };
}

let serverClient = makeServerClient();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => serverClient),
}));

let adminClient = makeAdminClient();
const createSupabaseAdminClientMock = vi.fn(() => adminClient);
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

const hasClaimedInviteMock = vi.fn(async () => true);
vi.mock("@/lib/db/invites", () => ({
  hasClaimedInvite: hasClaimedInviteMock,
}));

const isAdminMock = vi.fn(() => false);
vi.mock("@/lib/admin/isAdmin", () => ({
  isAdmin: isAdminMock,
}));

// ── ONE shared mutable in-memory session record per test ───────────────────
function freshSessionStore() {
  return {
    user_id: "user-1",
    stage: "anchor",
    messages: [] as unknown[],
    extracted: {} as Record<string, unknown>,
    modules: {} as Record<string, unknown>,
    status: "in_progress",
  };
}

let sessionStore = freshSessionStore();

const getOrCreateSessionMock = vi.fn(async () => ({
  ...sessionStore,
  extracted: { ...sessionStore.extracted },
  modules: { ...sessionStore.modules },
}));
const saveSessionMock = vi.fn(async (_supabase: unknown, _userId: string, updates: Record<string, unknown>) => {
  Object.assign(sessionStore, updates);
});
vi.mock("@/lib/db/onboardingSession", () => ({
  getOrCreateSession: getOrCreateSessionMock,
  saveSession: saveSessionMock,
}));

// getProfileDoc always null — no profiles row exists client-side yet
// (checkpoint.ts itself creates that row, via the admin client above, not
// this wrapper). upsertProfileDoc is consequently never exercised.
const getProfileDocMock = vi.fn(async () => null);
const upsertProfileDocMock = vi.fn(async () => ({ status: "valid" as const, errors: [] as string[] }));
vi.mock("@/lib/db/profiles", () => ({
  getProfileDoc: getProfileDocMock,
  upsertProfileDoc: upsertProfileDocMock,
}));

// buildCheckpointDeps is the ONLY checkpoint-adjacent thing mocked — real
// checkpoint.ts / moduleRegistry.ts / incrementalDoc.ts all run unmocked.
const dispatchHuntMock = vi.fn(async () => ({}));
const buildCheckpointDepsMock = vi.fn(() => ({
  admin: adminClient,
  dispatchHunt: dispatchHuntMock,
  cooldownHours: 6,
  githubRepo: undefined,
  githubToken: undefined,
  fetchImpl: fetch,
  now: () => new Date("2026-07-16T00:00:00.000Z"),
}));
vi.mock("@/lib/onboarding/checkpointDeps", () => ({
  buildCheckpointDeps: buildCheckpointDepsMock,
}));

const { POST: anchorPost } = await import("../anchor/route");
const { POST: reactionsPost } = await import("../modules/reactions/route");
const { POST: keyPost } = await import("../modules/[key]/route");

function anchorRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/anchor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function reactionRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/modules/reactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function keyRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/modules/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(key: string) {
  return { params: Promise.resolve({ key }) };
}

async function postAnchor() {
  const res = await anchorPost(anchorRequest({ current_title: "Staff Engineer", current_company: "Acme" }));
  expect(res.status).toBe(200);
  return res;
}

async function postReactionsToCompletion() {
  let res: Response | undefined;
  for (let i = 0; i < 6; i++) {
    const reaction = i % 2 === 0 ? "interested" : "not_interested";
    res = await reactionsPost(reactionRequest({ posting_id: `posting-${i + 1}`, reaction }));
    expect(res.status).toBe(200);
  }
  return res as Response;
}

async function postValues() {
  const choices = VALUE_PAIRS.slice(0, 6).map((pair) => ({ pair_id: pair.pair_id, choice: "a" }));
  const res = await keyPost(keyRequest(choices), ctx("values"));
  expect(res.status).toBe(200);
  return res;
}

async function postDealbreakers() {
  const res = await keyPost(
    keyRequest({ hard_disqualifiers: ["defense"], soft_concerns: [] }),
    ctx("dealbreakers")
  );
  expect(res.status).toBe(200);
  return res;
}

beforeEach(() => {
  sessionStore = freshSessionStore();
  serverClient = makeServerClient();
  adminClient = makeAdminClient();
  createSupabaseAdminClientMock.mockClear();
  hasClaimedInviteMock.mockClear();
  isAdminMock.mockClear();
  getOrCreateSessionMock.mockClear();
  saveSessionMock.mockClear();
  getProfileDocMock.mockClear();
  upsertProfileDocMock.mockClear();
  dispatchHuntMock.mockClear();
  buildCheckpointDepsMock.mockClear();
});

describe("phase 1 checkpoint integration — real routes, real moduleRegistry/checkpoint", () => {
  it("anchor-first: anchor, reactions x6, values, dealbreakers — checkpoint fires exactly once, after dealbreakers", async () => {
    await postAnchor();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(0);

    await postReactionsToCompletion();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(0);

    await postValues();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(0);

    await postDealbreakers();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(1);

    // Idempotency across repeat calls, not just across the four distinct
    // modules: a redo/resubmit of an already-complete module must not
    // re-fire the checkpoint.
    await postDealbreakers();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(1);
  });

  it("anchor-last: reactions x6, values, dealbreakers, anchor — checkpoint fires exactly once, after anchor", async () => {
    await postReactionsToCompletion();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(0);

    await postValues();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(0);

    await postDealbreakers();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(0);

    await postAnchor();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(1);

    // Idempotency across repeat calls, not just across the four distinct
    // modules: a redo/resubmit of an already-complete module must not
    // re-fire the checkpoint.
    await postDealbreakers();
    expect(dispatchHuntMock).toHaveBeenCalledTimes(1);
  });
});
