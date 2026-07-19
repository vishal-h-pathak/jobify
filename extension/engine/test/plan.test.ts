import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { planFills, requiredEmptyForPlan } from "../src/plan.js";
import { survey } from "../src/survey.js";
import type { FillInstruction, SurveyField } from "../src/types.js";
import { mountAshbyFixture, mountWorkdayFixture } from "./fixtures/builders.js";
import { alexQuinnPacket } from "./fixtures/packet.js";

function mountHtmlFixture(name: string): void {
  document.body.innerHTML = readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");
}

function fieldById(fields: SurveyField[], id: string): SurveyField {
  const f = fields.find((x) => x.id === id);
  if (!f) throw new Error(`no field with id ${id}`);
  return f;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("planFills — greenhouse", () => {
  it("emits instructions for every mapped identity field, keyed by packet source", () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "greenhouse");

    const byLabel = (label: string) => {
      const instr = plan.find((i) => fieldById(s.fields, i.fieldId).label === label);
      if (!instr) throw new Error(`no instruction for ${label}`);
      return instr;
    };

    expect(byLabel("First Name")).toMatchObject({ value: "Alex", source: "identity.first_name" });
    expect(byLabel("Last Name")).toMatchObject({ value: "Quinn", source: "identity.last_name" });
    expect(byLabel("Email")).toMatchObject({ value: "alex@example.com", source: "identity.email" });
    expect(byLabel("Phone")).toMatchObject({ value: "555-0100", source: "identity.phone" });
    expect(byLabel("LinkedIn URL")).toMatchObject({ source: "identity.linkedin_url" });
    expect(byLabel("Location")).toMatchObject({ value: "Atlanta, GA", source: "identity.location" });
  });

  it("emits a file instruction for the resume and a textarea instruction for the cover letter", () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "greenhouse");

    const resumeField = s.fields.find((f) => f.kind === "file")!;
    const resumeInstr = plan.find((i) => i.fieldId === resumeField.id)!;
    expect(resumeInstr.source).toBe("materials.resume_pdf");
    expect(resumeInstr.value).toContain("resume.pdf");

    const clField = s.fields.find((f) => f.kind === "textarea")!;
    const clInstr = plan.find((i) => i.fieldId === clField.id)!;
    expect(clInstr.source).toBe("materials.cover_letter_text");
    expect(clInstr.value).toContain("Alex Quinn");
  });

  it("never emits instructions for Company/Title labels (no packet source)", () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "greenhouse");
    const labels = plan.map((i) => fieldById(s.fields, i.fieldId).label);
    expect(labels).not.toContain("Current Company");
    expect(labels).not.toContain("Current Title");
  });

  it("requiredEmpty is empty for a fully-populated packet", () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "greenhouse");
    expect(requiredEmptyForPlan(plan)).toEqual([]);
  });

  it("requiredEmpty reports a required label whose packet value is missing", () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const packet = alexQuinnPacket({ identity: { ...alexQuinnPacket().identity, phone: "" } });
    const plan = planFills(s, packet, "greenhouse");
    expect(requiredEmptyForPlan(plan)).toContain("Phone");
    // and no instruction was emitted for the unresolved field
    const phoneField = s.fields.find((f) => f.label === "Phone")!;
    expect(plan.some((i) => i.fieldId === phoneField.id)).toBe(false);
  });
});

describe("planFills — lever full-name override", () => {
  it("overrides Full Name/Name to the computed full name, applied after First Name in fill order", () => {
    mountHtmlFixture("lever.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "lever");

    const nameField = s.fields.find((f) => f.name === "name")!;
    const onNameField = plan.filter((i) => i.fieldId === nameField.id);

    // First Name (plain first name) fills first, then Full Name / Name
    // (the computed full name) overwrite it — net result: full name.
    expect(onNameField.map((i) => i.value)).toEqual(["Alex", "Alex Quinn", "Alex Quinn"]);
    expect(onNameField.at(-1)!.source).toBe("identity.full_name");
  });

  it("falls back to first+last when the packet has no full_name", () => {
    mountHtmlFixture("lever.html");
    const s = survey(document);
    const packet = alexQuinnPacket({ identity: { ...alexQuinnPacket().identity, full_name: "" } });
    const plan = planFills(s, packet, "lever");
    const nameField = s.fields.find((f) => f.name === "name")!;
    const last = plan.filter((i) => i.fieldId === nameField.id).at(-1)!;
    expect(last.value).toBe("Alex Quinn");
  });
});

describe("planFills — ashby (fuzzy name fallback + label fallback)", () => {
  beforeEach(() => mountAshbyFixture(document));

  it("matches First Name via the fuzzy name selector (no explicit name map)", () => {
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "ashby");
    const first = s.fields.find((f) => f.name === "applicant_firstname")!;
    expect(plan.some((i) => i.fieldId === first.id && i.value === "Alex")).toBe(true);
  });

  it("matches Phone and Resume via label fallback (no name/automationId available)", () => {
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "ashby");
    const phone = s.fields.find((f) => f.label === "Phone")!;
    expect(plan.some((i) => i.fieldId === phone.id && i.value === "555-0100")).toBe(true);
    const resume = s.fields.find((f) => f.label === "Resume")!;
    expect(plan.some((i) => i.fieldId === resume.id)).toBe(true);
  });
});

describe("planFills — workday (data-automation-id matching)", () => {
  beforeEach(() => mountWorkdayFixture(document));

  it("matches every identity field by automationId, including inside the shadow-rendered address section", () => {
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "workday");

    const city = s.fields.find((f) => f.automationId === "addressSection_city")!;
    expect(plan.some((i) => i.fieldId === city.id && i.value === "Atlanta, GA")).toBe(true);

    const first = s.fields.find((f) => f.automationId === "legalNameSection_firstName")!;
    expect(plan.some((i) => i.fieldId === first.id && i.value === "Alex")).toBe(true);
  });

  it("never emits a Source instruction — the packet has no such data", () => {
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "workday");
    const source = s.fields.find((f) => f.automationId === "source");
    expect(source).toBeDefined();
    expect(plan.some((i) => i.fieldId === source!.id)).toBe(false);
  });
});

describe("planFills — generic ATS", () => {
  it("returns no instructions (L0 maps only; L1 heuristics are a later layer)", () => {
    mountHtmlFixture("generic.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "generic");
    expect(plan).toEqual([]);
    expect(requiredEmptyForPlan(plan)).toEqual([]);
  });
});

describe("requiredEmptyForPlan", () => {
  it("degrades gracefully for a plan array not produced by planFills", () => {
    const handBuilt: FillInstruction[] = [{ fieldId: "f1", value: "x", source: "identity.email" }];
    expect(requiredEmptyForPlan(handBuilt)).toEqual([]);
  });
});
