import { describe, expect, it, vi } from "vitest";
import { CALIBRATION_INTRO_COPY, type ChatMessage } from "@/lib/anthropic/interview";
import {
  CALIBRATION_LOADING_LINES,
  CalibrationPanel,
  calibrationAnswersValid,
  formatCalibrationSubmission,
  nextLoadingLineIndex,
  parseCalibrationPrompts,
} from "./CalibrationPanel";

function introMessage(prompts: string[]): ChatMessage {
  return {
    role: "assistant",
    content: `${CALIBRATION_INTRO_COPY}\n\n${prompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
  };
}

describe("parseCalibrationPrompts — recovering prompts from the persisted intro message", () => {
  it("extracts all 4 prompts in order from the intro message", () => {
    const prompts = [
      "A user reports a flaky deploy. Walk me through how you'd handle it.",
      "Which parts of the job around your title do you get pulled into?",
      "If your next role were outside this lane, what would it be?",
      "Describe one piece of work you'd actually show someone.",
    ];
    const messages: ChatMessage[] = [introMessage(prompts)];
    expect(parseCalibrationPrompts(messages)).toEqual(prompts);
  });

  it("finds the intro message even after later turns were appended", () => {
    const prompts = ["depth", "breadth", "range", "evidence"];
    const messages: ChatMessage[] = [
      introMessage(prompts),
      { role: "user", content: "1. ans1\n\n2. ans2\n\n3. ans3\n\n4. ans4" },
    ];
    expect(parseCalibrationPrompts(messages)).toEqual(prompts);
  });

  it("returns an empty array when no intro message has been generated yet", () => {
    expect(parseCalibrationPrompts([])).toEqual([]);
  });

  it("returns an empty array for a fresh anchor-stage session with unrelated messages", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "unrelated text" }];
    expect(parseCalibrationPrompts(messages)).toEqual([]);
  });
});

describe("formatCalibrationSubmission — one message covering all four answers", () => {
  it("numbers each answer to match the intro's ordering", () => {
    const result = formatCalibrationSubmission(["first", "second", "third", "fourth"]);
    expect(result).toBe("1. first\n\n2. second\n\n3. third\n\n4. fourth");
  });

  it("trims each answer", () => {
    const result = formatCalibrationSubmission(["  padded  ", "b", "c", "d"]);
    expect(result).toBe("1. padded\n\n2. b\n\n3. c\n\n4. d");
  });
});

describe("calibrationAnswersValid", () => {
  it("false until all four are non-blank", () => {
    expect(calibrationAnswersValid(["", "", "", ""])).toBe(false);
    expect(calibrationAnswersValid(["a", "b", "c", ""])).toBe(false);
    expect(calibrationAnswersValid(["a", "b", "c"])).toBe(false);
  });

  it("true once all four have content", () => {
    expect(calibrationAnswersValid(["a", "b", "c", "d"])).toBe(true);
  });

  it("whitespace-only answers don't count", () => {
    expect(calibrationAnswersValid(["a", "b", "c", "   "])).toBe(false);
  });
});

describe("nextLoadingLineIndex — rotation cycle", () => {
  it("cycles through and wraps back to 0", () => {
    expect(nextLoadingLineIndex(0, CALIBRATION_LOADING_LINES.length)).toBe(1);
    expect(nextLoadingLineIndex(1, CALIBRATION_LOADING_LINES.length)).toBe(0);
  });
});

describe("CalibrationPanel — rendered tree", () => {
  const prompts = ["depth probe text", "breadth probe text", "range probe text", "evidence probe text"];

  it("renders one elevated card per prompt with its own textarea", () => {
    const view = CalibrationPanel({
      introCopy: CALIBRATION_INTRO_COPY,
      prompts,
      answers: ["", "", "", ""],
      submitting: false,
      error: "",
      onAnswerChange: vi.fn(),
      onSubmit: vi.fn(),
    });
    const [, cardList] = view.props.children;
    expect(cardList.props.children).toHaveLength(4);
    const [firstCard] = cardList.props.children;
    expect(firstCard.props.variant).toBe("elevated");
    const [, promptText, textarea] = firstCard.props.children;
    expect(promptText.props.children).toBe("depth probe text");
    expect(textarea.props.value).toBe("");
  });

  it("disables submit until all four answers are filled", () => {
    const view = CalibrationPanel({
      introCopy: CALIBRATION_INTRO_COPY,
      prompts,
      answers: ["a", "b", "c", ""],
      submitting: false,
      error: "",
      onAnswerChange: vi.fn(),
      onSubmit: vi.fn(),
    });
    const [, , , submitButton] = view.props.children;
    expect(submitButton.props.disabled).toBe(true);
  });

  it("enables submit and wires onSubmit once all four are filled", () => {
    const onSubmit = vi.fn();
    const view = CalibrationPanel({
      introCopy: CALIBRATION_INTRO_COPY,
      prompts,
      answers: ["a", "b", "c", "d"],
      submitting: false,
      error: "",
      onAnswerChange: vi.fn(),
      onSubmit,
    });
    const [, , , submitButton] = view.props.children;
    expect(submitButton.props.disabled).toBe(false);
    submitButton.props.onClick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders the intro copy verbatim", () => {
    const view = CalibrationPanel({
      introCopy: CALIBRATION_INTRO_COPY,
      prompts,
      answers: ["", "", "", ""],
      submitting: false,
      error: "",
      onAnswerChange: vi.fn(),
      onSubmit: vi.fn(),
    });
    const [header] = view.props.children;
    const [, introParagraph] = header.props.children;
    expect(introParagraph.props.children).toBe(CALIBRATION_INTRO_COPY);
  });
});
