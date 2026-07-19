import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { survey } from "../src/survey.js";
import { mountAshbyFixture, mountIframeFixture, mountWorkdayFixture } from "./fixtures/builders.js";

function fixturePath(name: string): string {
  return join(import.meta.dirname, "fixtures", name);
}

function mountHtmlFixture(name: string): void {
  document.body.innerHTML = readFileSync(fixturePath(name), "utf-8");
}

function field(s: ReturnType<typeof survey>, label: string) {
  const f = s.fields.find((x) => x.label === label);
  if (!f) throw new Error(`no field with label ${JSON.stringify(label)} in [${s.fields.map((x) => x.label).join(", ")}]`);
  return f;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("survey — greenhouse fixture", () => {
  it("finds the standard identity fields with correct kind/name/required", () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);

    const first = field(s, "First Name");
    expect(first.kind).toBe("text");
    expect(first.name).toBe("job_application[first_name]");
    expect(first.required).toBe(true);
    expect(first.frame).toBe("");

    expect(field(s, "Email").kind).toBe("text");
    expect(field(s, "Phone").name).toBe("job_application[phone]");
  });

  it("surveys the native select with its options", () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    const source = field(s, "How did you hear about us?");
    expect(source.kind).toBe("select");
    expect(source.options).toEqual(["Select...", "Referral", "Job Board", "Company Website"]);
  });

  it("surveys the file input as required and the cover letter as textarea", () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    expect(field(s, "Resume").kind).toBe("file");
    expect(field(s, "Resume").required).toBe(true);
    expect(field(s, "Cover Letter").kind).toBe("textarea");
  });

  it("surveys the submit button as kind submit, never as a field", () => {
    mountHtmlFixture("greenhouse.html");
    const s = survey(document);
    expect(s.buttons).toHaveLength(1);
    expect(s.buttons[0]!.label).toBe("Submit Application");
    expect(s.buttons[0]!.kind).toBe("submit");
    expect(s.fields.some((f) => f.label === "Submit Application")).toBe(false);
  });
});

describe("survey — lever fixture", () => {
  it("resolves the full-name field via <label for>", () => {
    mountHtmlFixture("lever.html");
    const s = survey(document);
    const name = field(s, "Full Name");
    expect(name.name).toBe("name");
    expect(name.required).toBe(true);
  });
});

describe("survey — generic fixture (autocomplete only, no labels)", () => {
  it("falls back to the name attribute as label and still records autocomplete", () => {
    mountHtmlFixture("generic.html");
    const s = survey(document);
    const email = field(s, "email_addr");
    expect(email.autocomplete).toBe("email");
    const phone = field(s, "phone_num");
    expect(phone.autocomplete).toBe("tel");
  });
});

describe("survey — ashby-like fixture (shadow root, fuzzy names, combobox, radio, checkbox, contenteditable)", () => {
  beforeEach(() => mountAshbyFixture(document));

  it("resolves aria-label fields with fuzzy names, all within the main frame", () => {
    const s = survey(document);
    const first = field(s, "First Name");
    expect(first.name).toBe("applicant_firstname");
    expect(first.required).toBe(true);
    expect(first.frame).toBe("");
  });

  it("traverses the open shadow root for the Location field", () => {
    const s = survey(document);
    const loc = field(s, "Location");
    expect(loc.name).toBe("location_fuzzy");
    expect(loc.frame).toBe(""); // shadow DOM does not change the frame path
  });

  it("groups radios into one radio_group field with option labels and a fieldset-legend group label", () => {
    const s = survey(document);
    const workAuth = field(s, "Are you authorized to work in the US?");
    expect(workAuth.kind).toBe("radio_group");
    expect(workAuth.options).toEqual(["Yes", "No"]);
    expect(workAuth.value).toBe(""); // neither radio pre-checked
  });

  it("surveys a checkbox with boolean-as-string value", () => {
    const s = survey(document);
    const agree = field(s, "I agree to the terms");
    expect(agree.kind).toBe("checkbox");
    expect(agree.value).toBe("");
  });

  it("detects the custom listbox widget as combobox with its option labels", () => {
    const s = survey(document);
    const source = field(s, "How did you hear about us?");
    expect(source.kind).toBe("combobox");
    expect(source.options).toEqual(["Referral", "Job Board", "Company Website"]);
  });

  it("surveys the file input hidden behind a dropzone despite zero-opacity styling", () => {
    const s = survey(document);
    const resume = field(s, "Resume");
    expect(resume.kind).toBe("file");
    expect(resume.required).toBe(true);
  });

  it("treats a contenteditable div as a textarea-kind field", () => {
    const s = survey(document);
    const cl = field(s, "Cover Letter");
    expect(cl.kind).toBe("textarea");
  });
});

describe("survey — workday-like fixture (data-automation-id, shadow root, typeahead)", () => {
  beforeEach(() => mountWorkdayFixture(document));

  it("captures data-automation-id as automationId", () => {
    const s = survey(document);
    const first = field(s, "First Name");
    expect(first.automationId).toBe("legalNameSection_firstName");
  });

  it("traverses the shadow-rendered address section", () => {
    const s = survey(document);
    const city = field(s, "City");
    expect(city.automationId).toBe("addressSection_city");
    expect(city.frame).toBe("");
  });

  it("surveys the country typeahead as a combobox requiring option selection", () => {
    const s = survey(document);
    const country = field(s, "Country");
    expect(country.kind).toBe("combobox");
    expect(country.automationId).toBe("countryDropdown");
    expect(country.options).toEqual(["United States of America", "Canada", "United Kingdom"]);
  });

  it("surveys the file upload and native select", () => {
    const s = survey(document);
    expect(field(s, "Resume").kind).toBe("file");
    expect(field(s, "Source").kind).toBe("select");
  });
});

describe("survey — same-origin iframe fixture", () => {
  it("assigns a frame path to fields inside a same-origin iframe", () => {
    mountIframeFixture(document);
    const s = survey(document);
    const first = field(s, "First Name");
    expect(first.frame).toBe("iframe0");
    expect(field(s, "Email").frame).toBe("iframe0");
  });

  it("surveys buttons inside the iframe too", () => {
    mountIframeFixture(document);
    const s = survey(document);
    expect(s.buttons.some((b) => b.label === "Submit Application")).toBe(true);
  });
});

describe("survey — label resolution ladder, rung by rung", () => {
  it("rung 1: <label for> wins even when aria-label is also present", () => {
    document.body.innerHTML = `<label for="x">Label A</label><input id="x" aria-label="Ignored">`;
    const s = survey(document);
    expect(s.fields[0]!.label).toBe("Label A");
  });

  it("rung 2: wrapping <label> when there is no for/id match", () => {
    document.body.innerHTML = `<label>Label B <input></label>`;
    const s = survey(document);
    expect(s.fields[0]!.label).toBe("Label B");
  });

  it("rung 3a: aria-label, when neither label form matches", () => {
    document.body.innerHTML = `<input aria-label="Label C" placeholder="Ignored">`;
    const s = survey(document);
    expect(s.fields[0]!.label).toBe("Label C");
  });

  it("rung 3b: aria-labelledby, when there is no aria-label", () => {
    document.body.innerHTML = `<span id="lbl">Label D</span><input aria-labelledby="lbl" placeholder="Ignored">`;
    const s = survey(document);
    expect(s.fields[0]!.label).toBe("Label D");
  });

  it("rung 4: placeholder, when nothing else matches", () => {
    document.body.innerHTML = `<input placeholder="Label E">`;
    const s = survey(document);
    expect(s.fields[0]!.label).toBe("Label E");
  });

  it("rung 5: nearest preceding text, when nothing else matches", () => {
    document.body.innerHTML = `<span>Label F</span><input>`;
    const s = survey(document);
    expect(s.fields[0]!.label).toBe("Label F");
  });

  it("rung 5: fieldset legend, when nothing else matches", () => {
    document.body.innerHTML = `<fieldset><legend>Label G</legend><input></fieldset>`;
    const s = survey(document);
    expect(s.fields[0]!.label).toBe("Label G");
  });

  it("falls back to the name attribute when every rung misses", () => {
    document.body.innerHTML = `<input name="mystery_field">`;
    const s = survey(document);
    expect(s.fields[0]!.label).toBe("mystery_field");
  });
});

describe("survey — visibility and non-field exclusions", () => {
  it("excludes a display:none text input", () => {
    document.body.innerHTML = `<input name="hidden_text" style="display:none">`;
    const s = survey(document);
    expect(s.fields).toHaveLength(0);
  });

  it("still surveys a display:none file input (F4 — hidden behind a dropzone)", () => {
    document.body.innerHTML = `<input type="file" name="resume" style="display:none">`;
    const s = survey(document);
    expect(s.fields).toHaveLength(1);
    expect(s.fields[0]!.kind).toBe("file");
  });

  it("excludes input[type=hidden] and input[type=submit] from fields", () => {
    document.body.innerHTML = `<input type="hidden" name="csrf" value="x"><input type="submit" value="Go">`;
    const s = survey(document);
    expect(s.fields).toHaveLength(0);
  });
});

describe("survey — kind detection", () => {
  it("detects a date input", () => {
    document.body.innerHTML = `<input type="date" name="start_date">`;
    const s = survey(document);
    expect(s.fields[0]!.kind).toBe("date");
  });

  it("detects a checkbox", () => {
    document.body.innerHTML = `<input type="checkbox" name="agree">`;
    const s = survey(document);
    expect(s.fields[0]!.kind).toBe("checkbox");
  });
});
