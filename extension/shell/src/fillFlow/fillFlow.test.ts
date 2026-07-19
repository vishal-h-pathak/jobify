import { describe, expect, it, vi } from "vitest";
import { runFillFlow, fillFlowErrorMessage, type FillFlowDeps } from "./fillFlow";
import type { EngineApi } from "../engineApi";
import type { SubmitPacket, Survey, FillReport } from "../engineTypes";

function fakePacket(overrides: Partial<SubmitPacket> = {}): SubmitPacket {
  return {
    posting: { id: "p1", title: "Staff Engineer", company: "Acme", application_url: "https://boards.greenhouse.io/acme/1", ats_kind: "greenhouse" },
    identity: {
      first_name: "Alex",
      last_name: "Quinn",
      full_name: "Alex Quinn",
      email: "alex@example.com",
      phone: "555-0100",
      location: "",
      linkedin_url: "https://linkedin.com/in/alex",
      github_url: "",
      portfolio_url: "",
    },
    materials: { resume_pdf_url: "https://storage.example.com/resume.pdf", cover_letter_pdf_url: "https://storage.example.com/cl.pdf", cover_letter_text: "Dear team," },
    authorization: {},
    logistics: {},
    self_id: {},
    meta: { tailor_run_id: "run-1", doc_sha256: null, generated_at: "2026-07-19T00:00:00Z" },
    ...overrides,
  };
}

function fakeEngine(overrides: Partial<EngineApi> = {}): EngineApi {
  const survey: Survey = { url: "https://boards.greenhouse.io/acme/1", fields: [], buttons: [] };
  const report: FillReport = { outcomes: [], requiredEmpty: [] };
  return {
    survey: vi.fn(() => survey),
    planFills: vi.fn(() => []),
    executeFills: vi.fn(async () => report),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function pdfResponse(status = 200): Response {
  return status === 200 ? new Response(new Blob(["%PDF"]), { status }) : new Response("", { status });
}

describe("runFillFlow", () => {
  it("needs_setup on packet 409, never calls the engine", async () => {
    const engine = fakeEngine();
    const fetchImpl = vi.fn(async () => new Response("", { status: 409 }));
    const deps: FillFlowDeps = { engine, fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" };

    const result = await runFillFlow(deps, document, "p1");

    expect(result).toEqual({ kind: "needs_setup" });
    expect(engine.survey).not.toHaveBeenCalled();
  });

  it("no_materials on packet 404", async () => {
    const engine = fakeEngine();
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const deps: FillFlowDeps = { engine, fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" };

    expect(await runFillFlow(deps, document, "p1")).toEqual({ kind: "no_materials" });
  });

  it("packet_error on any other non-ok packet status", async () => {
    const engine = fakeEngine();
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const deps: FillFlowDeps = { engine, fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" };

    expect(await runFillFlow(deps, document, "p1")).toEqual({ kind: "packet_error", status: 500 });
  });

  it("generic ATS: never calls survey/planFills/executeFills, returns a full-packet handoff dump", async () => {
    const packet = fakePacket({ posting: { ...fakePacket().posting, ats_kind: "icims" } });
    const engine = fakeEngine();
    const fetchImpl = vi.fn(async () => jsonResponse(packet));
    const deps: FillFlowDeps = { engine, fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" };

    const result = await runFillFlow(deps, document, "p1");

    expect(result.kind).toBe("generic");
    if (result.kind === "generic") {
      expect(result.handoffLines).toContainEqual({ label: "First name", value: "Alex" });
      expect(result.handoffLines).toContainEqual({ label: "LinkedIn URL", value: "https://linkedin.com/in/alex" });
    }
    expect(engine.survey).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no PDF fetches for a generic ATS
  });

  it("mapped ATS: fetches materials into Files and passes them to executeFills, renders filled/stuck/required-empty + handoff lines", async () => {
    const packet = fakePacket();
    const survey: Survey = { url: packet.posting.application_url, fields: [], buttons: [] };
    const report: FillReport = {
      outcomes: [
        { fieldId: "f1", label: "Phone", layer: "map", attempted: true, filled: true, stuckAfterReadback: false, strategy: "native" },
        { fieldId: "f2", label: "LinkedIn URL", layer: "map", attempted: true, filled: false, stuckAfterReadback: true, strategy: "keystrokes" },
      ],
      requiredEmpty: ["Resume upload"],
    };
    const plan = [{ fieldId: "f2", value: "https://linkedin.com/in/alex", source: "identity.linkedin_url" }];
    const engine: EngineApi = {
      survey: vi.fn(() => survey),
      planFills: vi.fn(() => plan),
      executeFills: vi.fn(async (_root, _s, receivedPlan, files) => {
        expect(receivedPlan).toBe(plan);
        expect(files.resume).toBeInstanceOf(File);
        expect(files.cover_letter).toBeInstanceOf(File);
        return report;
      }),
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("api/submit/packet")) return jsonResponse(packet);
      return pdfResponse(200);
    });
    const deps: FillFlowDeps = { engine, fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" };

    const result = await runFillFlow(deps, document, "p1");

    expect(engine.planFills).toHaveBeenCalledWith(survey, packet, "greenhouse");
    expect(result).toEqual({
      kind: "filled",
      packet,
      checklist: [
        { label: "Phone", status: "filled" },
        { label: "LinkedIn URL", status: "stuck" },
        { label: "Resume upload", status: "required_empty" },
      ],
      handoffLines: [{ label: "LinkedIn URL", value: "https://linkedin.com/in/alex" }],
      reminders: ["Resume upload"],
    });
  });

  it("refetches the packet exactly once when a signed material URL has expired, then proceeds with fresh Files", async () => {
    const packet = fakePacket();
    let packetFetches = 0;
    let resumeFetches = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("api/submit/packet")) {
        packetFetches++;
        return jsonResponse(packet);
      }
      if (url.includes("resume")) {
        resumeFetches++;
        return resumeFetches === 1 ? pdfResponse(403) : pdfResponse(200); // expired first time, fresh second time
      }
      return pdfResponse(200);
    });
    const engine = fakeEngine();
    const deps: FillFlowDeps = { engine, fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" };

    const result = await runFillFlow(deps, document, "p1");

    expect(packetFetches).toBe(2); // one initial + exactly one retry
    expect(resumeFetches).toBe(2);
    expect(result.kind).toBe("filled");
    const executeFillsCall = (engine.executeFills as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(executeFillsCall[3].resume).toBeInstanceOf(File);
  });
});

describe("fillFlowErrorMessage", () => {
  it("returns the exact 409 copy", () => {
    expect(fillFlowErrorMessage({ kind: "needs_setup" })).toBe("finish submitter setup in the app first");
  });

  it("returns null for a filled/generic result — nothing to render as an error", () => {
    expect(fillFlowErrorMessage({ kind: "generic", packet: fakePacket(), handoffLines: [] })).toBeNull();
  });
});
