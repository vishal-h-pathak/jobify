import { describe, expect, it } from "vitest";
import { classifyQuestion } from "./classifyQuestion";

describe("classifyQuestion", () => {
  it("classifies the resume-stage opener as resume_ask", () => {
    expect(classifyQuestion("resume", "Have a resume handy? Paste/upload it — or skip, we already have plenty.")).toBe(
      "resume_ask"
    );
  });

  it("classifies the resume reflect-back confirm as resume_confirm", () => {
    expect(
      classifyQuestion("resume", "Staff engineer, 8 years, Go/Python — anything wrong or missing?")
    ).toBe("resume_confirm");
  });

  it("classifies the batched logistics opener as logistics", () => {
    expect(
      classifyQuestion(
        "targeting",
        "Logistics, all in one go: where are you based, remote-only or is some onsite fine, and what's the salary floor?"
      )
    ).toBe("logistics");
  });

  it("classifies a trade-off question as tradeoff", () => {
    expect(classifyQuestion("targeting", "Two postings, same title — which ranks higher for you, or no preference?")).toBe(
      "tradeoff"
    );
  });

  it("classifies a more-of/done-with question", () => {
    expect(classifyQuestion("targeting", "What's one thing you want more of, and one you're done with?")).toBe(
      "more_of_done_with"
    );
  });

  it("classifies a companies/watchlist question", () => {
    expect(classifyQuestion("targeting", "Any specific companies for the watchlist?")).toBe("companies");
  });

  it("classifies a direction question", () => {
    expect(classifyQuestion("targeting", "Which of these next-role directions fits best?")).toBe("direction");
  });

  it("falls back to generic for unrecognized targeting content", () => {
    expect(classifyQuestion("targeting", "One more thing — any particular team size you gravitate toward?")).toBe(
      "generic"
    );
  });

  it("falls back to generic outside resume/targeting stages", () => {
    expect(classifyQuestion("calibration", "Anything else about your range?")).toBe("generic");
    expect(classifyQuestion("done", "All set!")).toBe("generic");
  });
});
