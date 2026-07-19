import { describe, expect, it } from "vitest";
import { buildChecklist, buildHandoffLines, buildFullPacketHandoffLines } from "./handoffLines";
import type { FillReport, FillInstruction, SubmitPacket } from "../engineTypes";

function outcome(overrides: Partial<FillReport["outcomes"][number]>): FillReport["outcomes"][number] {
  return { fieldId: "f1", label: "Phone", layer: "map", attempted: true, filled: true, stuckAfterReadback: false, strategy: "native", ...overrides };
}

describe("buildChecklist", () => {
  it("maps filled outcomes to filled, unfilled attempted outcomes to stuck, and requiredEmpty to required_empty", () => {
    const report: FillReport = {
      outcomes: [
        outcome({ fieldId: "f1", label: "Phone", filled: true }),
        outcome({ fieldId: "f2", label: "LinkedIn", filled: false, stuckAfterReadback: true }),
      ],
      requiredEmpty: ["Cover letter upload"],
    };
    expect(buildChecklist(report)).toEqual([
      { label: "Phone", status: "filled" },
      { label: "LinkedIn", status: "stuck" },
      { label: "Cover letter upload", status: "required_empty" },
    ]);
  });
});

describe("buildHandoffLines", () => {
  it("emits a valued line for each attempted-but-unfilled field, sourced from the plan's value", () => {
    const plan: FillInstruction[] = [{ fieldId: "f2", value: "https://linkedin.com/in/alex", source: "identity.linkedin_url" }];
    const report: FillReport = {
      outcomes: [
        outcome({ fieldId: "f1", label: "Phone", filled: true }),
        outcome({ fieldId: "f2", label: "LinkedIn", filled: false, stuckAfterReadback: true }),
      ],
      requiredEmpty: [],
    };
    expect(buildHandoffLines(report, plan)).toEqual({
      valued: [{ label: "LinkedIn", value: "https://linkedin.com/in/alex" }],
      reminders: [],
    });
  });

  it("never emits a line for a filled field even if it happens to be in the plan", () => {
    const plan: FillInstruction[] = [{ fieldId: "f1", value: "555-0100", source: "identity.phone" }];
    const report: FillReport = { outcomes: [outcome({ fieldId: "f1", label: "Phone", filled: true })], requiredEmpty: [] };
    expect(buildHandoffLines(report, plan).valued).toEqual([]);
  });

  it("skips a field with no matching plan value (never attempted) rather than emitting an empty-value line", () => {
    const report: FillReport = { outcomes: [outcome({ fieldId: "f1", label: "Phone", attempted: false, filled: false })], requiredEmpty: [] };
    expect(buildHandoffLines(report, []).valued).toEqual([]);
  });

  it("passes requiredEmpty through as bare reminders", () => {
    const report: FillReport = { outcomes: [], requiredEmpty: ["Why this company?"] };
    expect(buildHandoffLines(report, []).reminders).toEqual(["Why this company?"]);
  });
});

function fakePacket(): SubmitPacket {
  return {
    posting: { id: "p1", title: "t", company: "c", application_url: "https://x.com", ats_kind: "icims" },
    identity: {
      first_name: "Alex",
      last_name: "Quinn",
      full_name: "Alex Quinn",
      email: "alex@example.com",
      phone: "555-0100",
      location: "",
      linkedin_url: "",
      github_url: "",
      portfolio_url: "",
    },
    materials: { resume_pdf_url: "https://x/resume.pdf", cover_letter_pdf_url: "https://x/cl.pdf", cover_letter_text: "Dear team," },
    authorization: { work_authorized: "yes" },
    logistics: {},
    self_id: {},
    meta: { tailor_run_id: "run-1", doc_sha256: null, generated_at: "2026-07-19T00:00:00Z" },
  };
}

describe("buildFullPacketHandoffLines", () => {
  it("dumps every non-empty packet value as a copyable label:value line", () => {
    const lines = buildFullPacketHandoffLines(fakePacket());
    expect(lines).toContainEqual({ label: "First name", value: "Alex" });
    expect(lines).toContainEqual({ label: "Phone", value: "555-0100" });
    expect(lines).toContainEqual({ label: "Cover letter", value: "Dear team," });
    expect(lines).toContainEqual({ label: "Authorized to work", value: "yes" });
  });

  it("omits empty fields entirely", () => {
    const lines = buildFullPacketHandoffLines(fakePacket());
    expect(lines.find((l) => l.label === "Location")).toBeUndefined();
    expect(lines.find((l) => l.label === "LinkedIn URL")).toBeUndefined();
  });
});
