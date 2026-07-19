import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { executeFills } from "../src/fill.js";
import { planFills } from "../src/plan.js";
import { survey } from "../src/survey.js";
import type { EngineFiles, FillInstruction, Survey, SurveyField } from "../src/types.js";
import { mountKeystrokeOnlyInput } from "./fixtures/keystrokeOnlyInput.js";
import { alexQuinnPacket } from "./fixtures/packet.js";
import { FIELD_ID_ATTR } from "../src/dom.js";

function mountHtmlFixture(name: string): void {
  document.body.innerHTML = readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");
}

function surveyOf(field: Partial<SurveyField>): Survey {
  return {
    url: "",
    fields: [
      {
        id: "f1",
        kind: "text",
        label: "Field",
        name: "",
        autocomplete: "",
        required: false,
        value: "",
        frame: "",
        ...field,
      },
    ],
    buttons: [],
  };
}

const NO_FILES: EngineFiles = {};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("executeFills — greenhouse end to end", () => {
  it("fills identity fields and reports them as filled with the native strategy", async () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "greenhouse");
    const report = await executeFills(document, s, plan, NO_FILES);

    const first = report.outcomes.find((o) => o.label === "First Name")!;
    expect(first.attempted).toBe(true);
    expect(first.filled).toBe(true);
    expect(first.stuckAfterReadback).toBe(false);
    expect(first.strategy).toBe("native");
    expect((document.getElementById("first_name") as HTMLInputElement).value).toBe("Alex");
  });

  it("uploads the resume file and reports it filled", async () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "greenhouse");
    const resume = new File(["%PDF fake"], "resume.pdf", { type: "application/pdf" });
    const report = await executeFills(document, s, plan, { resume });

    const outcome = report.outcomes.find((o) => o.label === "Resume")!;
    expect(outcome.filled).toBe(true);
    expect((document.getElementById("resume") as HTMLInputElement).files?.[0]?.name).toBe("resume.pdf");
  });

  it("requiredEmpty is empty for a complete packet", async () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "greenhouse");
    const report = await executeFills(document, s, plan, {
      resume: new File(["x"], "resume.pdf", { type: "application/pdf" }),
    });
    expect(report.requiredEmpty).toEqual([]);
  });

  it("requiredEmpty surfaces a required field the packet had no value for", async () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const packet = alexQuinnPacket({ identity: { ...alexQuinnPacket().identity, phone: "" } });
    const plan = planFills(s, packet, "greenhouse");
    const report = await executeFills(document, s, plan, {
      resume: new File(["x"], "resume.pdf", { type: "application/pdf" }),
    });
    expect(report.requiredEmpty).toContain("Phone");
  });

  it("requiredEmpty also catches a DOM-required field the map never attempted (defensive net)", async () => {
    mountHtmlFixture("greenhouse.html");
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="field"><label for="extra">Work Sample URL</label><input id="extra" required></div>`,
    );
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "greenhouse");
    const report = await executeFills(document, s, plan, {
      resume: new File(["x"], "resume.pdf", { type: "application/pdf" }),
    });
    expect(report.requiredEmpty).toContain("Work Sample URL");
  });
});

describe("executeFills — Lever last-instruction-wins on a shared field", () => {
  it("ends up with the full name after First Name is overwritten by Full Name/Name", async () => {
    mountHtmlFixture("lever.html");
    const s = survey(document);
    const plan = planFills(s, alexQuinnPacket(), "lever");
    await executeFills(document, s, plan, {
      resume: new File(["x"], "resume.pdf", { type: "application/pdf" }),
    });
    expect((document.getElementById("name") as HTMLInputElement).value).toBe("Alex Quinn");
  });
});

describe("executeFills — read-back escalation", () => {
  it("escalates to keystrokes when the native bulk write is reverted, and reports that strategy", async () => {
    const input = mountKeystrokeOnlyInput(document, "x");
    input.setAttribute(FIELD_ID_ATTR, "f1");
    const s = surveyOf({ id: "f1", kind: "text", label: "Field" });
    const plan: FillInstruction[] = [{ fieldId: "f1", value: "Alex", source: "identity.first_name" }];

    const report = await executeFills(document, s, plan, NO_FILES);
    const outcome = report.outcomes[0]!;
    // Native's single bulk write has no keydown behind it and gets
    // reverted; keystrokes fires a real keydown before each character's
    // input event, so the retry succeeds.
    expect(outcome.strategy).toBe("keystrokes");
    expect(outcome.filled).toBe(true);
    expect(outcome.stuckAfterReadback).toBe(false);
  });

  it("marks stuckAfterReadback honestly when even keystrokes can't make it stick", async () => {
    document.body.innerHTML = `<input id="x" ${FIELD_ID_ATTR}="f1">`;
    const input = document.getElementById("x") as HTMLInputElement;
    // A field that discards every write, including one routed straight
    // through the prototype's own setter function — representative of a
    // framework whose commit path lives entirely outside `value` (e.g. a
    // masked-input library that only accepts its own paste handler).
    // Neither native nor keystrokes can win against this; the report must
    // say so honestly rather than claim success.
    Object.defineProperty(input, "value", {
      configurable: true,
      get() {
        return "";
      },
      set() {
        // discard every write attempt
      },
    });

    const s = surveyOf({ id: "f1", kind: "text", label: "Field" });
    const plan: FillInstruction[] = [{ fieldId: "f1", value: "Alex", source: "identity.first_name" }];
    const report = await executeFills(document, s, plan, NO_FILES);
    const outcome = report.outcomes[0]!;
    expect(outcome.filled).toBe(false);
    expect(outcome.stuckAfterReadback).toBe(true);
    expect(outcome.strategy).toBe("keystrokes");
  });
});

describe("executeFills — combobox read-back", () => {
  it("reports filled when the widget updates its own displayed text on selection", async () => {
    document.body.innerHTML = `
      <div id="x" role="combobox" ${FIELD_ID_ATTR}="f1">
        <span class="display"></span>
        <ul role="listbox">
          <li role="option">Job Board</li>
        </ul>
      </div>`;
    const container = document.getElementById("x")!;
    const option = container.querySelector('[role="option"]')!;
    // Simulates what a real widget's own click handler does: close and
    // show the committed selection, replacing the container's content.
    option.addEventListener("click", () => {
      container.innerHTML = `<span class="display">Job Board</span>`;
    });

    const s = surveyOf({ id: "f1", kind: "combobox", label: "How did you hear about us?" });
    const plan: FillInstruction[] = [{ fieldId: "f1", value: "Job Board", source: "identity.source" }];
    const report = await executeFills(document, s, plan, NO_FILES);
    expect(report.outcomes[0]!.filled).toBe(true);
  });

  it("honestly reports stuckAfterReadback when the widget never updates (static fixture)", async () => {
    // A placeholder plus multiple options — textContent stays a
    // concatenation of all of them, which normalizes to something other
    // than "job board" unless a real widget replaces it on selection (as
    // the previous test simulates). Without that, read-back must not
    // claim success just because the target text happens to appear
    // somewhere inside the container.
    document.body.innerHTML = `
      <div id="x" role="combobox" ${FIELD_ID_ATTR}="f1">
        <div class="placeholder">Select...</div>
        <ul role="listbox">
          <li role="option">Referral</li>
          <li role="option">Job Board</li>
        </ul>
      </div>`;
    const s = surveyOf({ id: "f1", kind: "combobox", label: "How did you hear about us?" });
    const plan: FillInstruction[] = [{ fieldId: "f1", value: "Job Board", source: "identity.source" }];
    const report = await executeFills(document, s, plan, NO_FILES);
    expect(report.outcomes[0]!.attempted).toBe(true);
    expect(report.outcomes[0]!.filled).toBe(false);
    expect(report.outcomes[0]!.stuckAfterReadback).toBe(true);
  });
});

describe("executeFills — never throws past an instruction", () => {
  it("reports an unattempted outcome when the instruction's fieldId no longer exists", async () => {
    const s = surveyOf({ id: "f1" });
    const plan: FillInstruction[] = [{ fieldId: "ghost", value: "x", source: "identity.email" }];
    const report = await executeFills(document, s, plan, NO_FILES);
    expect(report.outcomes[0]).toMatchObject({ attempted: false, filled: false, stuckAfterReadback: false });
  });
});
