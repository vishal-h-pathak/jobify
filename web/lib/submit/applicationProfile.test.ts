import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadApplicationProfile,
  sanitizeApplicationProfile,
  saveApplicationProfile,
} from "./applicationProfile";
import { decryptJson } from "@/lib/crypto/keys";

const TEST_SECRET_B64 = Buffer.alloc(32, 1).toString("base64");

// Chainable fake admin client — `.from("application_profiles").select().eq().maybeSingle()`
// plus `.upsert()`, same style as `app/api/tailor/materials/[runId]/route.test.ts`.
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const upsertMock = vi.fn();
const fromMock = vi.fn(() => ({ select: selectMock, upsert: upsertMock }));
const adminClient = { from: fromMock } as unknown as Parameters<typeof loadApplicationProfile>[0];

const ALEX_QUINN_PROFILE_INPUT = {
  contact: {
    phone: "555-0100",
    location: "Remote",
    linkedin_url: "https://linkedin.example/in/alexquinn",
  },
  authorization: { work_authorized: "yes" as const, visa_sponsorship_needed: "no" as const },
  logistics: { notice_period: "2 weeks" },
  self_id: { veteran_status: "no" },
};

describe("sanitizeApplicationProfile", () => {
  it("picks only the pinned shape's keys and drops everything else", () => {
    const result = sanitizeApplicationProfile({
      contact: { phone: "555-0100", not_a_real_field: "nope" },
      authorization: { work_authorized: "yes" },
      logistics: {},
      self_id: {},
      updated_at: "2020-01-01T00:00:00.000Z", // must never be read from input
      extra_top_level_key: "should be stripped",
    });
    expect(result).toEqual({
      contact: { phone: "555-0100" },
      authorization: { work_authorized: "yes" },
      logistics: {},
      self_id: {},
    });
    expect(result).not.toHaveProperty("extra_top_level_key");
    expect((result.contact as Record<string, unknown>)).not.toHaveProperty("not_a_real_field");
    // updated_at from the input is ignored entirely by the sanitizer — it's
    // stamped later, server-side, by saveApplicationProfile.
    expect(result.updated_at).toBeUndefined();
  });

  it("defaults a missing or malformed sub-object to {}", () => {
    const result = sanitizeApplicationProfile({
      contact: "not an object",
      logistics: null,
      // authorization and self_id omitted entirely
    });
    expect(result).toEqual({ contact: {}, authorization: {}, logistics: {}, self_id: {} });
  });

  it("omits a wrong-typed leaf field rather than defaulting it to an empty string", () => {
    const result = sanitizeApplicationProfile({
      contact: { phone: 5551234 },
      authorization: { work_authorized: "maybe" }, // not in the "yes"|"no" union
    });
    expect(result.contact).not.toHaveProperty("phone");
    expect(result.authorization).not.toHaveProperty("work_authorized");
  });

  it("handles non-object top-level input by returning the all-empty shape", () => {
    expect(sanitizeApplicationProfile(null)).toEqual({
      contact: {},
      authorization: {},
      logistics: {},
      self_id: {},
    });
    expect(sanitizeApplicationProfile("garbage")).toEqual({
      contact: {},
      authorization: {},
      logistics: {},
      self_id: {},
    });
  });

  it("accepts the literal yes/no union for both authorization fields", () => {
    const result = sanitizeApplicationProfile({
      authorization: { work_authorized: "no", visa_sponsorship_needed: "yes", notes: "case pending" },
    });
    expect(result.authorization).toEqual({
      work_authorized: "no",
      visa_sponsorship_needed: "yes",
      notes: "case pending",
    });
  });
});

describe("loadApplicationProfile / saveApplicationProfile", () => {
  beforeEach(() => {
    vi.stubEnv("JOBIFY_KEY_ENCRYPTION_SECRET", TEST_SECRET_B64);
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({ error: null });
  });

  it("returns null before any save has ever happened", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const result = await loadApplicationProfile(adminClient, "user-1");
    expect(result).toBeNull();
    expect(fromMock).toHaveBeenCalledWith("application_profiles");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("save -> load round-trips the sanitized shape", async () => {
    let storedRow: { user_id: string; encrypted_payload: string; updated_at: string } | null = null;
    upsertMock.mockImplementation(async (row) => {
      storedRow = row;
      return { error: null };
    });

    const saved = await saveApplicationProfile(adminClient, "user-1", ALEX_QUINN_PROFILE_INPUT);
    expect(saved.contact).toEqual(ALEX_QUINN_PROFILE_INPUT.contact);
    expect(saved.authorization).toEqual(ALEX_QUINN_PROFILE_INPUT.authorization);
    expect(saved.logistics).toEqual(ALEX_QUINN_PROFILE_INPUT.logistics);
    expect(saved.self_id).toEqual(ALEX_QUINN_PROFILE_INPUT.self_id);
    expect(typeof saved.updated_at).toBe("string");

    expect(storedRow).not.toBeNull();
    expect(storedRow!.user_id).toBe("user-1");
    expect(storedRow!.updated_at).toBe(saved.updated_at);

    maybeSingleMock.mockResolvedValue({
      data: { encrypted_payload: storedRow!.encrypted_payload },
      error: null,
    });
    const loaded = await loadApplicationProfile(adminClient, "user-1");
    expect(loaded).toEqual(saved);
  });

  it("strips unknown top-level and nested keys before they ever reach encryption", async () => {
    let storedRow: { encrypted_payload: string } | null = null;
    upsertMock.mockImplementation(async (row) => {
      storedRow = row;
      return { error: null };
    });

    await saveApplicationProfile(adminClient, "user-1", {
      contact: { phone: "555-0100", ssn: "should never be stored" },
      injected_top_level_field: "should never be stored",
    });

    const decrypted = decryptJson<Record<string, unknown>>(storedRow!.encrypted_payload);
    expect(decrypted).not.toHaveProperty("injected_top_level_field");
    expect((decrypted.contact as Record<string, unknown>)).not.toHaveProperty("ssn");
    expect(JSON.stringify(decrypted)).not.toContain("should never be stored");
  });

  it("stores genuine ciphertext — the raw upserted payload is not the plaintext JSON", async () => {
    let storedRow: { encrypted_payload: string } | null = null;
    upsertMock.mockImplementation(async (row) => {
      storedRow = row;
      return { error: null };
    });

    const saved = await saveApplicationProfile(adminClient, "user-1", ALEX_QUINN_PROFILE_INPUT);

    const plaintext = JSON.stringify(saved);
    expect(storedRow!.encrypted_payload).not.toBe(plaintext);
    expect(storedRow!.encrypted_payload).not.toContain("555-0100");
    expect(() => JSON.parse(storedRow!.encrypted_payload)).toThrow();

    const decrypted = decryptJson(storedRow!.encrypted_payload);
    expect(decrypted).toEqual(saved);
  });

  it("throws on a SELECT error instead of swallowing it", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "rls denied" } });
    await expect(loadApplicationProfile(adminClient, "user-1")).rejects.toEqual({ message: "rls denied" });
  });

  it("throws on an upsert error instead of swallowing it", async () => {
    upsertMock.mockResolvedValue({ error: { message: "upsert failed" } });
    await expect(saveApplicationProfile(adminClient, "user-1", {})).rejects.toEqual({
      message: "upsert failed",
    });
  });
});
