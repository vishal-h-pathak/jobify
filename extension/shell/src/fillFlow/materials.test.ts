import { describe, expect, it, vi } from "vitest";
import { fetchMaterialFiles, materialsIncomplete } from "./materials";
import type { SubmitPacket } from "../engineTypes";

function fakePacket(overrides: Partial<SubmitPacket["materials"]> = {}): SubmitPacket {
  return {
    posting: { id: "p1", title: "t", company: "c", application_url: "https://x.com", ats_kind: "greenhouse" },
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
      resume_pdf_url: "https://storage.example.com/resume.pdf?sig=1",
      cover_letter_pdf_url: "https://storage.example.com/cl.pdf?sig=1",
      cover_letter_text: "Dear hiring team,",
      ...overrides,
    },
    authorization: {},
    logistics: {},
    self_id: {},
    meta: { tailor_run_id: "run-1", doc_sha256: null, generated_at: "2026-07-19T00:00:00Z" },
  };
}

describe("fetchMaterialFiles", () => {
  it("fetches both PDFs (no credentials option — signed URLs authorize via their own token)", async () => {
    const packet = fakePacket();
    const fetchImpl = vi.fn(async (url: string) => new Response(new Blob([`content:${url}`]), { status: 200 }));

    const files = await fetchMaterialFiles(fetchImpl as unknown as typeof fetch, packet);

    expect(fetchImpl).toHaveBeenCalledWith(packet.materials.resume_pdf_url);
    expect(fetchImpl).toHaveBeenCalledWith(packet.materials.cover_letter_pdf_url);
    for (const call of fetchImpl.mock.calls) expect(call).toHaveLength(1); // no options object — no credentials sent
    expect(files.resume).toBeInstanceOf(File);
    expect(files.resume?.name).toBe("resume.pdf");
    expect(files.cover_letter).toBeInstanceOf(File);
    expect(files.cover_letter?.name).toBe("cover_letter.pdf");
  });

  it("skips a material whose signed URL is empty", async () => {
    const packet = fakePacket({ cover_letter_pdf_url: "" });
    const fetchImpl = vi.fn(async () => new Response(new Blob(["x"]), { status: 200 }));

    const files = await fetchMaterialFiles(fetchImpl as unknown as typeof fetch, packet);

    expect(files.resume).toBeInstanceOf(File);
    expect(files.cover_letter).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("leaves a material undefined when its fetch fails (e.g. an expired signed URL)", async () => {
    const packet = fakePacket();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("resume") ? new Response("", { status: 403 }) : new Response(new Blob(["x"]), { status: 200 })
    );

    const files = await fetchMaterialFiles(fetchImpl as unknown as typeof fetch, packet);

    expect(files.resume).toBeUndefined();
    expect(files.cover_letter).toBeInstanceOf(File);
  });
});

describe("materialsIncomplete", () => {
  it("false when every promised material has a File", () => {
    const packet = fakePacket();
    const files = { resume: new File([], "resume.pdf"), cover_letter: new File([], "cl.pdf") };
    expect(materialsIncomplete(files, packet)).toBe(false);
  });

  it("true when a promised material is missing its File", () => {
    const packet = fakePacket();
    expect(materialsIncomplete({ resume: new File([], "resume.pdf") }, packet)).toBe(true);
  });

  it("false when the packet never promised a material in the first place", () => {
    const packet = fakePacket({ cover_letter_pdf_url: "" });
    expect(materialsIncomplete({ resume: new File([], "resume.pdf") }, packet)).toBe(false);
  });
});
