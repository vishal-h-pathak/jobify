import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDriver } from "../src/drivers.js";
import { FIELD_ID_ATTR } from "../src/dom.js";
import type { EngineFiles, FillInstruction, SurveyField } from "../src/types.js";
import { mountReactLikeControlledInput } from "./fixtures/reactLikeInput.js";

function textField(overrides: Partial<SurveyField> = {}): SurveyField {
  return {
    id: "f1",
    kind: "text",
    label: "First Name",
    name: "",
    autocomplete: "",
    required: false,
    value: "",
    frame: "",
    ...overrides,
  };
}

function instruction(overrides: Partial<FillInstruction> = {}): FillInstruction {
  return { fieldId: "f1", value: "Alex", source: "identity.first_name", ...overrides };
}

const NO_FILES: EngineFiles = {};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("runDriver — text (native strategy)", () => {
  it("writes through the native setter and dispatches input+change", async () => {
    document.body.innerHTML = `<input id="x" ${FIELD_ID_ATTR}="f1">`;
    const input = document.getElementById("x") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));

    const ok = await runDriver(document, textField(), instruction(), NO_FILES, "native");
    expect(ok).toBe(true);
    expect(input.value).toBe("Alex");
    expect(events).toEqual(["input", "change"]);
  });

  it("returns false when the field is no longer in the DOM", async () => {
    const ok = await runDriver(document, textField(), instruction(), NO_FILES, "native");
    expect(ok).toBe(false);
  });

  it("bypasses a React-style controlled input that ignores plain assignment", async () => {
    const input = mountReactLikeControlledInput(document, "x", "original");
    input.setAttribute(FIELD_ID_ATTR, "f1");

    // Sanity: a plain write really is dropped by this fixture.
    input.value = "typed directly";
    expect(input.value).toBe("original");

    const ok = await runDriver(document, textField(), instruction({ value: "Alex Quinn" }), NO_FILES, "native");
    expect(ok).toBe(true);
    expect(input.value).toBe("Alex Quinn");
  });
});

describe("runDriver — text (keystrokes escalation)", () => {
  it("dispatches a keydown/keypress/input/keyup sequence per character and a trailing change", async () => {
    document.body.innerHTML = `<input id="x" ${FIELD_ID_ATTR}="f1">`;
    const input = document.getElementById("x") as HTMLInputElement;
    const seen: string[] = [];
    for (const type of ["keydown", "keypress", "input", "keyup", "change"]) {
      input.addEventListener(type, () => seen.push(type));
    }

    const ok = await runDriver(document, textField(), instruction({ value: "ab" }), NO_FILES, "keystrokes");
    expect(ok).toBe(true);
    expect(input.value).toBe("ab");
    expect(seen).toEqual([
      "keydown", "keypress", "input", "keyup",
      "keydown", "keypress", "input", "keyup",
      "change",
    ]);
  });

  it("also bypasses a React-style controlled input", async () => {
    const input = mountReactLikeControlledInput(document, "x", "");
    input.setAttribute(FIELD_ID_ATTR, "f1");
    const ok = await runDriver(document, textField(), instruction({ value: "hi" }), NO_FILES, "keystrokes");
    expect(ok).toBe(true);
    expect(input.value).toBe("hi");
  });
});

describe("runDriver — textarea and contenteditable", () => {
  it("fills a <textarea> via the native setter", async () => {
    document.body.innerHTML = `<textarea id="x" ${FIELD_ID_ATTR}="f1"></textarea>`;
    const ok = await runDriver(
      document,
      textField({ kind: "textarea" }),
      instruction({ value: "cover letter body" }),
      NO_FILES,
      "native",
    );
    expect(ok).toBe(true);
    expect((document.getElementById("x") as HTMLTextAreaElement).value).toBe("cover letter body");
  });

  it("fills a contenteditable div via textContent + input event", async () => {
    document.body.innerHTML = `<div id="x" contenteditable="true" ${FIELD_ID_ATTR}="f1"></div>`;
    const div = document.getElementById("x")!;
    let firedInput = false;
    div.addEventListener("input", () => (firedInput = true));

    const ok = await runDriver(
      document,
      textField({ kind: "textarea" }),
      instruction({ value: "cover letter body" }),
      NO_FILES,
      "native",
    );
    expect(ok).toBe(true);
    expect(div.textContent).toBe("cover letter body");
    expect(firedInput).toBe(true);
  });
});

describe("runDriver — select", () => {
  it("matches by option value", async () => {
    document.body.innerHTML = `
      <select id="x" ${FIELD_ID_ATTR}="f1">
        <option value="">Select...</option>
        <option value="referral">Referral</option>
      </select>`;
    const ok = await runDriver(document, textField({ kind: "select" }), instruction({ value: "referral" }), NO_FILES, "native");
    expect(ok).toBe(true);
    expect((document.getElementById("x") as HTMLSelectElement).value).toBe("referral");
  });

  it("matches by visible option label when the value differs", async () => {
    document.body.innerHTML = `
      <select id="x" ${FIELD_ID_ATTR}="f1">
        <option value="ref">Referral</option>
      </select>`;
    const ok = await runDriver(document, textField({ kind: "select" }), instruction({ value: "Referral" }), NO_FILES, "native");
    expect(ok).toBe(true);
    expect((document.getElementById("x") as HTMLSelectElement).value).toBe("ref");
  });

  it("returns false when no option matches", async () => {
    document.body.innerHTML = `<select id="x" ${FIELD_ID_ATTR}="f1"><option value="a">A</option></select>`;
    const ok = await runDriver(document, textField({ kind: "select" }), instruction({ value: "Z" }), NO_FILES, "native");
    expect(ok).toBe(false);
  });
});

describe("runDriver — checkbox", () => {
  it("clicks to check when unchecked and the value is truthy", async () => {
    document.body.innerHTML = `<input type="checkbox" id="x" ${FIELD_ID_ATTR}="f1">`;
    const ok = await runDriver(document, textField({ kind: "checkbox" }), instruction({ value: "true" }), NO_FILES, "native");
    expect(ok).toBe(true);
    expect((document.getElementById("x") as HTMLInputElement).checked).toBe(true);
  });

  it("leaves an already-correct checkbox state untouched (no extra click)", async () => {
    document.body.innerHTML = `<input type="checkbox" id="x" checked ${FIELD_ID_ATTR}="f1">`;
    const input = document.getElementById("x") as HTMLInputElement;
    let clicks = 0;
    input.addEventListener("click", () => clicks++);
    const ok = await runDriver(document, textField({ kind: "checkbox" }), instruction({ value: "true" }), NO_FILES, "native");
    expect(ok).toBe(true);
    expect(clicks).toBe(0);
  });
});

describe("runDriver — radio_group", () => {
  it("matches by the wrapping <label> text", async () => {
    document.body.innerHTML = `
      <label><input type="radio" name="work_auth" value="yes" ${FIELD_ID_ATTR}="f1"> Yes</label>
      <label><input type="radio" name="work_auth" value="no" ${FIELD_ID_ATTR}="f1"> No</label>`;
    const ok = await runDriver(document, textField({ kind: "radio_group" }), instruction({ value: "No" }), NO_FILES, "native");
    expect(ok).toBe(true);
    expect((document.querySelector('input[value="no"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[value="yes"]') as HTMLInputElement).checked).toBe(false);
  });

  it("matches by the radio's own value attribute when there is no wrapping label", async () => {
    document.body.innerHTML = `
      <input type="radio" name="wa" value="yes" ${FIELD_ID_ATTR}="f1">
      <input type="radio" name="wa" value="no" ${FIELD_ID_ATTR}="f1">`;
    const ok = await runDriver(document, textField({ kind: "radio_group" }), instruction({ value: "yes" }), NO_FILES, "native");
    expect(ok).toBe(true);
    expect((document.querySelector('input[value="yes"]') as HTMLInputElement).checked).toBe(true);
  });
});

describe("runDriver — combobox", () => {
  it("opens, types the filter text, and clicks the matching option", async () => {
    document.body.innerHTML = `
      <div id="x" role="combobox" ${FIELD_ID_ATTR}="f1">
        <input type="text">
        <ul role="listbox">
          <li role="option">Referral</li>
          <li role="option">Job Board</li>
        </ul>
      </div>`;
    const jobBoard = Array.from(document.querySelectorAll('[role="option"]')).find(
      (o) => o.textContent === "Job Board",
    )!;
    const clicked = vi.fn();
    jobBoard.addEventListener("click", clicked);

    const ok = await runDriver(document, textField({ kind: "combobox" }), instruction({ value: "Job Board" }), NO_FILES, "native");
    expect(ok).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
    expect((document.querySelector("input") as HTMLInputElement).value).toBe("Job Board");
  });

  it("returns false when no option matches the filter value", async () => {
    document.body.innerHTML = `
      <div id="x" role="combobox" ${FIELD_ID_ATTR}="f1">
        <ul role="listbox"><li role="option">Referral</li></ul>
      </div>`;
    const ok = await runDriver(document, textField({ kind: "combobox" }), instruction({ value: "Nonexistent" }), NO_FILES, "native");
    expect(ok).toBe(false);
  });
});

describe("runDriver — file", () => {
  it("uploads the resume file via DataTransfer for a materials.resume_pdf source", async () => {
    document.body.innerHTML = `<input type="file" id="x" ${FIELD_ID_ATTR}="f1">`;
    const resume = new File(["%PDF-1.4 fake"], "resume.pdf", { type: "application/pdf" });
    let firedChange = false;
    document.getElementById("x")!.addEventListener("change", () => (firedChange = true));

    const ok = await runDriver(
      document,
      textField({ kind: "file" }),
      instruction({ source: "materials.resume_pdf", value: "https://example.com/resume.pdf" }),
      { resume },
      "native",
    );
    expect(ok).toBe(true);
    expect(firedChange).toBe(true);
    const input = document.getElementById("x") as HTMLInputElement;
    expect(input.files?.[0]?.name).toBe("resume.pdf");
  });

  it("returns false when the instruction's source doesn't resolve to a provided file", async () => {
    document.body.innerHTML = `<input type="file" id="x" ${FIELD_ID_ATTR}="f1">`;
    const ok = await runDriver(
      document,
      textField({ kind: "file" }),
      instruction({ source: "materials.resume_pdf" }),
      {}, // no resume file supplied
      "native",
    );
    expect(ok).toBe(false);
  });
});

describe("runDriver — unknown kind", () => {
  it("returns false without attempting anything", async () => {
    document.body.innerHTML = `<input id="x" ${FIELD_ID_ATTR}="f1">`;
    const ok = await runDriver(document, textField({ kind: "unknown" }), instruction(), NO_FILES, "native");
    expect(ok).toBe(false);
  });
});
