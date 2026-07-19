import { describe, expect, it, vi, beforeEach } from "vitest";

const loadApplicationProfileMock = vi.fn();
vi.mock("./applicationProfile", () => ({ loadApplicationProfile: loadApplicationProfileMock }));

const getProfileDocMock = vi.fn();
vi.mock("@/lib/db/profiles", () => ({ getProfileDoc: getProfileDocMock }));

const signMaterialsMock = vi.fn();
vi.mock("@/lib/materials/signMaterials", () => ({ signMaterials: signMaterialsMock }));

const buildIdentityMock = vi.fn();
vi.mock("./identity", () => ({ buildIdentity: buildIdentityMock }));

const detectAtsKindMock = vi.fn();
vi.mock("./atsDetect", () => ({ detectAtsKind: detectAtsKindMock }));

// Chainable fakes: `tailor_runs` gets 3 `.eq()` calls (user_id, posting_id,
// status) then `.order().limit().maybeSingle()`; `postings` gets a single
// `.eq()` then `.maybeSingle()`. Each step is its own `vi.fn()` (mirroring
// `app/api/tailor/materials/[runId]/route.test.ts`'s pattern) so tests can
// assert exactly which columns/values the query was scoped by.
const runsMaybeSingleMock = vi.fn();
const runsLimitMock = vi.fn(() => ({ maybeSingle: runsMaybeSingleMock }));
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEq3Mock = vi.fn(() => ({ order: runsOrderMock }));
const runsEq2Mock = vi.fn(() => ({ eq: runsEq3Mock }));
const runsEq1Mock = vi.fn(() => ({ eq: runsEq2Mock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEq1Mock }));

const postingsMaybeSingleMock = vi.fn();
const postingsEqMock = vi.fn(() => ({ maybeSingle: postingsMaybeSingleMock }));
const postingsSelectMock = vi.fn(() => ({ eq: postingsEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "tailor_runs") return { select: runsSelectMock };
  if (table === "postings") return { select: postingsSelectMock };
  throw new Error(`unexpected table: ${table}`);
});

const downloadMock = vi.fn();
const storageFromMock = vi.fn(() => ({ download: downloadMock }));

const adminClient = {
  from: fromMock,
  storage: { from: storageFromMock },
} as unknown as Parameters<typeof import("./packet").buildSubmitPacket>[0];

const { buildSubmitPacket } = await import("./packet");

const USER_ID = "user-1";
const AUTH_EMAIL = "alex@example.com";
const POSTING_ID = "posting-1";

function succeededRun() {
  return { id: "run-1", posting_id: POSTING_ID, doc_sha256: "deadbeef", status: "succeeded" };
}

function postingRow() {
  return { id: POSTING_ID, title: "Staff Engineer", company: "Acme", application_url: "https://boards.greenhouse.io/acme/jobs/1" };
}

function emptyApplicationProfile() {
  return { contact: {}, authorization: {}, logistics: {}, self_id: {} };
}

const IDENTITY_STUB = {
  first_name: "Alex",
  last_name: "Quinn",
  full_name: "Alex Quinn",
  email: AUTH_EMAIL,
  phone: "",
  location: "",
  linkedin_url: "",
  github_url: "",
  portfolio_url: "",
};

describe("buildSubmitPacket", () => {
  beforeEach(() => {
    loadApplicationProfileMock.mockReset();
    getProfileDocMock.mockReset();
    signMaterialsMock.mockReset();
    buildIdentityMock.mockReset();
    detectAtsKindMock.mockReset();

    fromMock.mockClear();
    runsSelectMock.mockClear();
    runsEq1Mock.mockClear();
    runsEq2Mock.mockClear();
    runsEq3Mock.mockClear();
    runsOrderMock.mockClear();
    runsLimitMock.mockClear();
    runsMaybeSingleMock.mockReset();
    postingsSelectMock.mockClear();
    postingsEqMock.mockClear();
    postingsMaybeSingleMock.mockReset();
    storageFromMock.mockClear();
    downloadMock.mockReset();

    getProfileDocMock.mockResolvedValue(null);
    signMaterialsMock.mockResolvedValue({});
    buildIdentityMock.mockReturnValue(IDENTITY_STUB);
    detectAtsKindMock.mockReturnValue("greenhouse");
    downloadMock.mockResolvedValue({ data: null, error: { message: "not found" } });
  });

  it("returns the 409 branch before any tailor_runs query runs when there is no application profile", async () => {
    loadApplicationProfileMock.mockResolvedValue(null);

    const result = await buildSubmitPacket(adminClient, USER_ID, AUTH_EMAIL, POSTING_ID);

    expect(result).toEqual({ ok: false, status: 409, error: "no_application_profile" });
    expect(fromMock).not.toHaveBeenCalled();
    expect(runsMaybeSingleMock).not.toHaveBeenCalled();
  });

  it("returns 404 no_materials when the application profile exists but no succeeded run matches the posting_id", async () => {
    loadApplicationProfileMock.mockResolvedValue(emptyApplicationProfile());
    runsMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const result = await buildSubmitPacket(adminClient, USER_ID, AUTH_EMAIL, POSTING_ID);

    expect(result).toEqual({ ok: false, status: 404, error: "no_materials" });
    expect(runsEq1Mock).toHaveBeenCalledWith("user_id", USER_ID);
    expect(runsEq2Mock).toHaveBeenCalledWith("posting_id", POSTING_ID);
    expect(runsEq3Mock).toHaveBeenCalledWith("status", "succeeded");
  });

  it("returns the identical 404 no_materials for a succeeded run belonging to a different user (query is scoped, not just the outcome)", async () => {
    // The fake ownership query is scoped by user_id AND posting_id, so a run
    // belonging to a different user never matches -> null, same as no run at
    // all. Assert the scoping, not just the status code.
    loadApplicationProfileMock.mockResolvedValue(emptyApplicationProfile());
    runsMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const result = await buildSubmitPacket(adminClient, USER_ID, AUTH_EMAIL, POSTING_ID);

    expect(result).toEqual({ ok: false, status: 404, error: "no_materials" });
    expect(runsEq1Mock).toHaveBeenCalledWith("user_id", USER_ID);
    expect(runsEq2Mock).toHaveBeenCalledWith("posting_id", POSTING_ID);
  });

  it("throws instead of swallowing a tailor_runs query error", async () => {
    loadApplicationProfileMock.mockResolvedValue(emptyApplicationProfile());
    runsMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(buildSubmitPacket(adminClient, USER_ID, AUTH_EMAIL, POSTING_ID)).rejects.toEqual({
      message: "boom",
    });
  });

  it("throws when the postings row is missing despite a succeeded tailor_runs row (FK invariant violated)", async () => {
    loadApplicationProfileMock.mockResolvedValue(emptyApplicationProfile());
    runsMaybeSingleMock.mockResolvedValue({ data: succeededRun(), error: null });
    postingsMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    await expect(buildSubmitPacket(adminClient, USER_ID, AUTH_EMAIL, POSTING_ID)).rejects.toThrow();
  });

  it("assembles the full packet on the happy path, matching the pinned SubmitPacket contract field-for-field", async () => {
    const applicationProfile = {
      contact: { phone: "555-0100" },
      authorization: { work_authorized: "yes" as const },
      logistics: { notice_period: "2 weeks" },
      self_id: { gender: "prefer not to say" },
    };
    loadApplicationProfileMock.mockResolvedValue(applicationProfile);
    runsMaybeSingleMock.mockResolvedValue({ data: succeededRun(), error: null });
    postingsMaybeSingleMock.mockResolvedValue({ data: postingRow(), error: null });
    getProfileDocMock.mockResolvedValue({ doc: { "profile.yml": "identity:\n  name: Alex Quinn" }, validationStatus: null });
    signMaterialsMock.mockResolvedValue({
      "resume.pdf": "https://sign/resume.pdf",
      "cover_letter.pdf": "https://sign/cover_letter.pdf",
    });
    downloadMock.mockResolvedValue({ data: { text: async () => "Dear hiring team," }, error: null });

    const result = await buildSubmitPacket(adminClient, USER_ID, AUTH_EMAIL, POSTING_ID);

    expect(result).toEqual({
      ok: true,
      packet: {
        posting: {
          id: POSTING_ID,
          title: "Staff Engineer",
          company: "Acme",
          application_url: "https://boards.greenhouse.io/acme/jobs/1",
          ats_kind: "greenhouse",
        },
        identity: IDENTITY_STUB,
        materials: {
          resume_pdf_url: "https://sign/resume.pdf",
          cover_letter_pdf_url: "https://sign/cover_letter.pdf",
          cover_letter_text: "Dear hiring team,",
        },
        authorization: { work_authorized: "yes" },
        logistics: { notice_period: "2 weeks" },
        self_id: { gender: "prefer not to say" },
        meta: {
          tailor_run_id: "run-1",
          doc_sha256: "deadbeef",
          generated_at: expect.any(String),
        },
      },
    });

    expect(buildIdentityMock).toHaveBeenCalledWith(
      { "profile.yml": "identity:\n  name: Alex Quinn" },
      applicationProfile,
      AUTH_EMAIL
    );
    expect(signMaterialsMock).toHaveBeenCalledWith(adminClient, USER_ID, POSTING_ID, 300);
    expect(detectAtsKindMock).toHaveBeenCalledWith("https://boards.greenhouse.io/acme/jobs/1");
  });

  it("defaults missing signed-URL entries and missing/errored cover-letter-text download to empty strings, never null/undefined", async () => {
    loadApplicationProfileMock.mockResolvedValue(emptyApplicationProfile());
    runsMaybeSingleMock.mockResolvedValue({ data: succeededRun(), error: null });
    postingsMaybeSingleMock.mockResolvedValue({
      data: { id: POSTING_ID, title: null, company: null, application_url: null },
      error: null,
    });
    signMaterialsMock.mockResolvedValue({});
    downloadMock.mockResolvedValue({ data: null, error: { message: "no such object" } });

    const result = await buildSubmitPacket(adminClient, USER_ID, AUTH_EMAIL, POSTING_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.packet.posting.title).toBe("");
    expect(result.packet.posting.company).toBe("");
    expect(result.packet.posting.application_url).toBe("");
    expect(result.packet.materials.resume_pdf_url).toBe("");
    expect(result.packet.materials.cover_letter_pdf_url).toBe("");
    expect(result.packet.materials.cover_letter_text).toBe("");
    expect(result.packet.authorization).toEqual({});
    expect(result.packet.logistics).toEqual({});
    expect(result.packet.self_id).toEqual({});
  });
});
