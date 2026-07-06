import { describe, expect, it, vi } from "vitest";
import {
  AnchorForm,
  anchorFormErrors,
  anchorFormValid,
  anchorReceiptFor,
  buildAnchorPayload,
  initialAnchorFormValues,
  type AnchorFormValues,
} from "./AnchorForm";

describe("anchorFormErrors / anchorFormValid — role mode", () => {
  it("requires both title and company", () => {
    expect(anchorFormErrors(initialAnchorFormValues)).toEqual([
      "Enter your current title.",
      "Enter your current company.",
    ]);
    expect(anchorFormValid(initialAnchorFormValues)).toBe(false);
  });

  it("valid once both are filled, tenure stays optional", () => {
    const values: AnchorFormValues = { ...initialAnchorFormValues, currentTitle: "Staff Engineer", currentCompany: "Acme" };
    expect(anchorFormErrors(values)).toEqual([]);
    expect(anchorFormValid(values)).toBe(true);
  });
});

describe("anchorFormErrors / anchorFormValid — situation mode (escape path)", () => {
  it("valid with free text alone, title/company still empty", () => {
    const values: AnchorFormValues = { ...initialAnchorFormValues, mode: "situation", freeText: "Between roles right now." };
    expect(anchorFormValid(values)).toBe(true);
  });

  it("valid with most-recent title+company alone, free text empty", () => {
    const values: AnchorFormValues = {
      ...initialAnchorFormValues,
      mode: "situation",
      currentTitle: "Backend Engineer",
      currentCompany: "OldCo",
    };
    expect(anchorFormValid(values)).toBe(true);
  });

  it("invalid when neither free text nor a full title+company pair is present", () => {
    const values: AnchorFormValues = { ...initialAnchorFormValues, mode: "situation", currentTitle: "Backend Engineer" };
    expect(anchorFormErrors(values)).toEqual([
      "Describe your situation, or fill in your most recent title and company.",
    ]);
  });
});

describe("buildAnchorPayload — matches POST /api/onboarding/anchor's own precedence", () => {
  it("role mode sends current_title + current_company, omits years_in_role when blank", () => {
    const values: AnchorFormValues = { ...initialAnchorFormValues, currentTitle: "PM", currentCompany: "Foo" };
    expect(buildAnchorPayload(values)).toEqual({ current_title: "PM", current_company: "Foo" });
  });

  it("role mode includes years_in_role when provided", () => {
    const values: AnchorFormValues = {
      ...initialAnchorFormValues,
      currentTitle: "PM",
      currentCompany: "Foo",
      yearsInRole: "3",
    };
    expect(buildAnchorPayload(values)).toEqual({ current_title: "PM", current_company: "Foo", years_in_role: "3" });
  });

  it("situation mode with free text sends free_text ALONE, even if title/company are also filled (server precedence)", () => {
    const values: AnchorFormValues = {
      ...initialAnchorFormValues,
      mode: "situation",
      currentTitle: "Backend Engineer",
      currentCompany: "OldCo",
      freeText: "Laid off last month, most recent role was backend.",
    };
    expect(buildAnchorPayload(values)).toEqual({ free_text: "Laid off last month, most recent role was backend." });
  });

  it("situation mode with only title/company (no free text) sends the pair", () => {
    const values: AnchorFormValues = {
      ...initialAnchorFormValues,
      mode: "situation",
      currentTitle: "Backend Engineer",
      currentCompany: "OldCo",
    };
    expect(buildAnchorPayload(values)).toEqual({ current_title: "Backend Engineer", current_company: "OldCo" });
  });
});

describe("anchorReceiptFor — StepSpine's Role receipt, derived from the submitted form", () => {
  it("formats title · company", () => {
    const values: AnchorFormValues = { ...initialAnchorFormValues, currentTitle: "PM", currentCompany: "Foo" };
    expect(anchorReceiptFor(values)).toBe("PM · Foo");
  });

  it("falls back to the free text when no title/company pair was sent", () => {
    const values: AnchorFormValues = { ...initialAnchorFormValues, mode: "situation", freeText: "A student, no work history yet." };
    expect(anchorReceiptFor(values)).toBe("A student, no work history yet.");
  });
});

describe("AnchorForm — rendered tree", () => {
  it("shows the free-text field only in situation mode, and the escape link toggles copy", () => {
    const roleView = AnchorForm({
      values: initialAnchorFormValues,
      submitting: false,
      error: "",
      onFieldChange: vi.fn(),
      onModeToggle: vi.fn(),
      onSubmit: vi.fn(),
    });
    const [, form] = roleView.props.children;
    // Children array (fixed positions; conditional slots are `false` when hidden):
    // [0] title, [1] company, [2] tenure, [3] free-text-or-false, [4] toggle, [5] error-or-false, [6] submit.
    expect(form.props.children[3]).toBeFalsy();
    const toggleLink = form.props.children[4];
    expect(toggleLink.props.children).toBe("I'm between roles / this doesn't fit");

    const situationView = AnchorForm({
      values: { ...initialAnchorFormValues, mode: "situation" },
      submitting: false,
      error: "",
      onFieldChange: vi.fn(),
      onModeToggle: vi.fn(),
      onSubmit: vi.fn(),
    });
    const [, situationForm] = situationView.props.children;
    expect(situationForm.props.children[3]).toBeTruthy();
    expect(situationForm.props.children[4].props.children).toBe("I have a current title after all");
  });

  it("disables submit until the form is valid, and the form's submit handler calls onSubmit", () => {
    const onSubmit = vi.fn();
    const view = AnchorForm({
      values: { ...initialAnchorFormValues, currentTitle: "PM", currentCompany: "Foo" },
      submitting: false,
      error: "",
      onFieldChange: vi.fn(),
      onModeToggle: vi.fn(),
      onSubmit,
    });
    const [, form] = view.props.children;
    const submitButton = form.props.children[6];
    expect(submitButton.props.type).toBe("submit");
    expect(submitButton.props.disabled).toBe(false);

    const preventDefault = vi.fn();
    form.props.onSubmit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps submit disabled while the form is invalid", () => {
    const view = AnchorForm({
      values: initialAnchorFormValues,
      submitting: false,
      error: "",
      onFieldChange: vi.fn(),
      onModeToggle: vi.fn(),
      onSubmit: vi.fn(),
    });
    const [, form] = view.props.children;
    const submitButton = form.props.children[6];
    expect(submitButton.props.disabled).toBe(true);
  });
});
