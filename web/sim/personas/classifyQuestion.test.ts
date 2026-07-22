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

  describe("Fix D (session 58): name bucket — the motivating live defect", () => {
    it("classifies every NAME_ONLY_VARIANTS phrasing as name, not generic", () => {
      const variants = [
        "What's your name?",
        "What should I call you?",
        "Still need a name for the profile — what is it?",
        "Last thing: what should the profile say for your name?",
        "One more time: what's your name?",
        "Just the name left — what should I put down?",
      ];
      for (const v of variants) expect(classifyQuestion("targeting", v)).toBe("name");
    });

    it("still classifies the combined logistics+name ask as logistics, unchanged", () => {
      expect(
        classifyQuestion(
          "targeting",
          "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), " +
            "and what's the salary floor below which you won't even look — and what's your name?"
        )
      ).toBe("logistics");
    });

    it("does not false-match the targeting/direction ask's 'name 2-3 directions' phrasing as the name topic", () => {
      expect(
        classifyQuestion(
          "targeting",
          "Based on your background as a Staff Engineer, name 2-3 concrete directions you'd want your next role " +
            "to take, and in a couple sentences, what you're optimizing for in this search."
        )
      ).toBe("direction");
    });
  });

  describe("Cockpit ruling (session 58 follow-up): direction is checked before companies", () => {
    it("classifies the direction ask's exact live phrasing — 'dream companies worth watching are optional' as a trailing suffix — as direction, not companies", () => {
      expect(
        classifyQuestion(
          "targeting",
          "Based on your background as a Staff Engineer, name 2-3 concrete directions you'd want your next role " +
            "to take, and in a couple sentences, what you're optimizing for in this search — any dream companies " +
            "worth watching are optional."
        )
      ).toBe("direction");
    });

    it("a real live-model rendering of the same ask (paraphrased, not the deterministic template) still classifies as direction", () => {
      expect(
        classifyQuestion(
          "targeting",
          "Based on where you sit as a Staff Platform Engineer, name 2-3 concrete directions you'd want your next " +
            "role to take (e.g., deeper into data infra, a step up to principal/lead, a specific domain), and in a " +
            "couple sentences, what you're optimizing for in this search. Any dream companies worth watching are optional."
        )
      ).toBe("direction");
    });

    it("a genuine companies-only ask (no direction/next-role keywords) still classifies as companies, unchanged", () => {
      expect(classifyQuestion("targeting", "Any specific companies for the watchlist?")).toBe("companies");
    });
  });
});
