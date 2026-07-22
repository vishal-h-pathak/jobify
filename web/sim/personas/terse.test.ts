import { describe, expect, it } from "vitest";
import { createTersePersona } from "./terse";
import { RESUME_SKIP_MESSAGE } from "../../lib/onboarding/handleTurn";

describe("createTersePersona", () => {
  it("gives a short non-empty answer for calibration", () => {
    const persona = createTersePersona();
    const answer = persona.answer({ stage: "calibration", lastAssistantText: "x", turnInStage: 1 });
    expect(answer.trim().length).toBeGreaterThan(0);
    expect(answer.split(/\s+/).length).toBeLessThan(30);
  });

  it("uses the reserved resume-skip sentinel on the resume stage, minimum viable words", () => {
    const persona = createTersePersona();
    const answer = persona.answer({
      stage: "resume",
      lastAssistantText: "Have a resume handy? Paste/upload it — or skip, we already have plenty.",
      turnInStage: 1,
    });
    expect(answer).toBe(RESUME_SKIP_MESSAGE);
  });

  it("gives a minimal logistics answer with location and salary floor", () => {
    const persona = createTersePersona();
    const answer = persona.answer({
      stage: "targeting",
      lastAssistantText: "Logistics, all in one go: where are you based, remote or hybrid, salary floor?",
      turnInStage: 1,
    });
    expect(answer).toMatch(/Denver/);
    expect(answer).toMatch(/175/);
    expect(answer.split(/\s+/).length).toBeLessThan(15);
  });

  it("gives distinct minimum-viable answers per targeting topic", () => {
    const persona = createTersePersona();
    const direction = persona.answer({ stage: "targeting", lastAssistantText: "Which direction?", turnInStage: 2 });
    const tradeoff = persona.answer({ stage: "targeting", lastAssistantText: "Postings — which ranks higher?", turnInStage: 3 });
    const moreOf = persona.answer({ stage: "targeting", lastAssistantText: "More of, done with?", turnInStage: 4 });
    const companies = persona.answer({ stage: "targeting", lastAssistantText: "Companies for the watchlist?", turnInStage: 5 });
    const generic = persona.answer({ stage: "targeting", lastAssistantText: "Team size preference?", turnInStage: 6 });

    for (const answer of [direction, tradeoff, moreOf, companies, generic]) {
      expect(answer.trim().length).toBeGreaterThan(0);
    }
    expect(new Set([direction, tradeoff, moreOf, companies, generic]).size).toBe(5);
  });

  it("Fix D (session 58): answers a pure name-only ask with a curt real name, not a deflection", () => {
    const persona = createTersePersona();
    const answer = persona.answer({ stage: "targeting", lastAssistantText: "What's your name?", turnInStage: 2 });
    expect(answer).toBe("Alex Quinn");
  });
});
