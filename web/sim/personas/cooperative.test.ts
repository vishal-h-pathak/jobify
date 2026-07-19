import { describe, expect, it } from "vitest";
import { createCooperativePersona } from "./cooperative";

describe("createCooperativePersona", () => {
  it("gives a single non-empty combined answer for the calibration stage, regardless of content", () => {
    const persona = createCooperativePersona();
    const answer = persona.answer({ stage: "calibration", lastAssistantText: "anything here", turnInStage: 1 });
    expect(answer.trim().length).toBeGreaterThan(0);
  });

  it("pastes resume text on the resume-stage opener", () => {
    const persona = createCooperativePersona();
    const answer = persona.answer({
      stage: "resume",
      lastAssistantText: "Have a resume handy? Paste/upload it — or skip, we already have plenty.",
      turnInStage: 1,
    });
    expect(answer).toContain("Alex Quinn");
  });

  it("confirms cleanly on the resume reflect-back", () => {
    const persona = createCooperativePersona();
    const answer = persona.answer({
      stage: "resume",
      lastAssistantText: "Staff engineer, ~8 years, Go/Python — anything wrong or missing?",
      turnInStage: 2,
    });
    expect(answer.toLowerCase()).toMatch(/accurate|correct|yes/);
  });

  it("gives a batched logistics answer including location and a salary floor", () => {
    const persona = createCooperativePersona();
    const answer = persona.answer({
      stage: "targeting",
      lastAssistantText: "Logistics, all in one go: where are you based, remote-only or hybrid, and salary floor?",
      turnInStage: 1,
    });
    expect(answer).toMatch(/Denver/);
    expect(answer).toMatch(/175/);
  });

  it("gives distinct non-empty answers for direction, tradeoff, more_of_done_with, and companies topics", () => {
    const persona = createCooperativePersona();
    const direction = persona.answer({ stage: "targeting", lastAssistantText: "Which next-role direction fits?", turnInStage: 2 });
    const tradeoff = persona.answer({ stage: "targeting", lastAssistantText: "Two postings — which ranks higher?", turnInStage: 3 });
    const moreOf = persona.answer({ stage: "targeting", lastAssistantText: "One thing more of, one done with?", turnInStage: 4 });
    const companies = persona.answer({ stage: "targeting", lastAssistantText: "Any companies for the watchlist?", turnInStage: 5 });

    for (const answer of [direction, tradeoff, moreOf, companies]) {
      expect(answer.trim().length).toBeGreaterThan(0);
    }
    expect(new Set([direction, tradeoff, moreOf, companies]).size).toBe(4);
  });

  it("gives a non-empty generic fallback for unrecognized targeting content", () => {
    const persona = createCooperativePersona();
    const answer = persona.answer({
      stage: "targeting",
      lastAssistantText: "One more thing — any team-size preference?",
      turnInStage: 6,
    });
    expect(answer.trim().length).toBeGreaterThan(0);
  });
});
