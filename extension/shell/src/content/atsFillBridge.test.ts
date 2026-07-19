import { describe, expect, it, vi, beforeEach } from "vitest";
import { installChromeMock, type ChromeMock } from "../testing/chromeMock";

// "jobify-engine" doesn't resolve to real files in this worktree (see
// types/jobify-engine.d.ts's header) — mock it so importing atsFillBridge.ts
// at all is possible, and so this test can drive a deterministic engine.
const surveyMock = vi.fn(() => ({ url: "https://boards.greenhouse.io/acme/1", fields: [], buttons: [] }));
const planFillsMock = vi.fn(() => []);
const executeFillsMock = vi.fn(async () => ({ outcomes: [], requiredEmpty: [] }));
vi.mock("jobify-engine", () => ({ survey: surveyMock, planFills: planFillsMock, executeFills: executeFillsMock }));

const packetJson = {
  posting: { id: "p1", title: "t", company: "c", application_url: "https://boards.greenhouse.io/acme/1", ats_kind: "greenhouse" },
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
  materials: { resume_pdf_url: "", cover_letter_pdf_url: "", cover_letter_text: "" },
  authorization: {},
  logistics: {},
  self_id: {},
  meta: { tailor_run_id: "run-1", doc_sha256: null, generated_at: "2026-07-19T00:00:00Z" },
};

const { installAtsFillBridge } = await import("./atsFillBridge");

describe("installAtsFillBridge", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
    surveyMock.mockClear();
    planFillsMock.mockClear();
    executeFillsMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(packetJson), { status: 200 }))
    );
  });

  it("responds to a fill_this_page message by running the fill flow against document and the real engine bindings", async () => {
    installAtsFillBridge();

    const response = await mock.emitRuntimeMessage({ type: "fill_this_page", postingId: "p1" });

    expect(surveyMock).toHaveBeenCalledWith(document);
    expect(response).toEqual({ kind: "filled", packet: packetJson, checklist: [], handoffLines: [], reminders: [] });
  });

  it("ignores a message that isn't fill_this_page", async () => {
    installAtsFillBridge();

    const response = await mock.emitRuntimeMessage({ type: "something_else" });

    expect(response).toBeUndefined();
    expect(surveyMock).not.toHaveBeenCalled();
  });
});
