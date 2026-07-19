import { describe, expect, it, vi } from "vitest";
import { fetchPacket } from "./packetClient";
import type { SubmitPacket } from "../engineTypes";

function fakePacket(): SubmitPacket {
  return {
    posting: { id: "p1", title: "Staff Engineer", company: "Acme", application_url: "https://x.com", ats_kind: "greenhouse" },
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
    materials: { resume_pdf_url: "https://storage.example.com/resume.pdf", cover_letter_pdf_url: "", cover_letter_text: "" },
    authorization: {},
    logistics: {},
    self_id: {},
    meta: { tailor_run_id: "run-1", doc_sha256: null, generated_at: "2026-07-19T00:00:00Z" },
  };
}

describe("fetchPacket", () => {
  it("GETs with the posting_id query param and credentials included, returns ok on 200", async () => {
    const packet = fakePacket();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(packet), { status: 200 }));

    const result = await fetchPacket({ fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" }, "p1");

    expect(fetchImpl).toHaveBeenCalledWith("https://app.example.com/api/submit/packet?posting_id=p1", { credentials: "include" });
    expect(result).toEqual({ kind: "ok", packet });
  });

  it("maps 409 to needs_setup", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 409 }));
    const result = await fetchPacket({ fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" }, "p1");
    expect(result).toEqual({ kind: "needs_setup" });
  });

  it("maps 404 to no_materials", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const result = await fetchPacket({ fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" }, "p1");
    expect(result).toEqual({ kind: "no_materials" });
  });

  it("maps any other non-ok status to error with the status", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const result = await fetchPacket({ fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" }, "p1");
    expect(result).toEqual({ kind: "error", status: 500 });
  });

  it("URL-encodes the posting_id", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fakePacket()), { status: 200 }));
    await fetchPacket({ fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" }, "p 1/2");
    expect(fetchImpl).toHaveBeenCalledWith("https://app.example.com/api/submit/packet?posting_id=p%201%2F2", { credentials: "include" });
  });
});
