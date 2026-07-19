import { describe, expect, it, vi } from "vitest";
import { fetchApplicationProfile, saveApplicationProfile, fetchSubmitPacket } from "./api";
import type { ApplicationProfile, SubmitPacket } from "./types";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe("fetchApplicationProfile", () => {
  it("200 returns the profile", async () => {
    const profile: ApplicationProfile = { contact: {}, authorization: {}, logistics: {}, self_id: {} };
    const result = await fetchApplicationProfile(fakeFetch(200, profile));
    expect(result).toEqual(profile);
  });

  it("404 (never onboarded) returns null, not a throw", async () => {
    expect(await fetchApplicationProfile(fakeFetch(404, { error: "not_found" }))).toBeNull();
  });

  it("a 500 throws", async () => {
    await expect(fetchApplicationProfile(fakeFetch(500, { error: "boom" }))).rejects.toThrow();
  });
});

describe("saveApplicationProfile", () => {
  it("posts the profile as JSON and resolves on 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 204, ok: true, json: () => Promise.resolve({}) });
    const profile: ApplicationProfile = {
      contact: { phone: "555-0100" },
      authorization: {},
      logistics: {},
      self_id: {},
    };
    await saveApplicationProfile(profile, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/submit/profile",
      expect.objectContaining({ method: "POST", body: JSON.stringify(profile) })
    );
  });

  it("throws the server's error message on failure", async () => {
    const fetchImpl = fakeFetch(400, { error: "invalid phone" });
    await expect(
      saveApplicationProfile({ contact: {}, authorization: {}, logistics: {}, self_id: {} }, fetchImpl)
    ).rejects.toThrow("invalid phone");
  });
});

describe("fetchSubmitPacket", () => {
  const packet: SubmitPacket = {
    posting: {
      id: "p1",
      title: "Staff Engineer",
      company: "Acme",
      application_url: "https://acme.example/apply",
      ats_kind: "greenhouse",
    },
    identity: {
      first_name: "Alex",
      last_name: "Quinn",
      full_name: "Alex Quinn",
      email: "alex@example.com",
      phone: "",
      location: "",
      linkedin_url: "",
      github_url: "",
      portfolio_url: "",
    },
    materials: {
      resume_pdf_url: "https://sign/resume.pdf",
      cover_letter_pdf_url: "https://sign/cl.pdf",
      cover_letter_text: "Dear hiring team,",
    },
    authorization: {},
    logistics: {},
    self_id: {},
    meta: { tailor_run_id: "run-1", doc_sha256: null, generated_at: "2026-07-18T00:00:00Z" },
  };

  it("200 returns a ready outcome with the packet", async () => {
    expect(await fetchSubmitPacket("p1", fakeFetch(200, packet))).toEqual({ kind: "ready", packet });
  });

  it("409 (no application profile yet) returns needs_setup", async () => {
    expect(await fetchSubmitPacket("p1", fakeFetch(409, { error: "no_application_profile" }))).toEqual({
      kind: "needs_setup",
    });
  });

  it("404 (no succeeded tailor run) returns no_materials", async () => {
    expect(await fetchSubmitPacket("p1", fakeFetch(404, { error: "no_materials" }))).toEqual({
      kind: "no_materials",
    });
  });

  it("anything else returns a generic error outcome", async () => {
    const outcome = await fetchSubmitPacket("p1", fakeFetch(500, {}));
    expect(outcome.kind).toBe("error");
  });
});
