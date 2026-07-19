import { describe, expect, it } from "vitest";
import { createMeanderingPersona } from "./meandering";

describe("createMeanderingPersona", () => {
  it("gives a long, rambling calibration answer that still buries the real content", () => {
    const persona = createMeanderingPersona();
    const answer = persona.answer({ stage: "calibration", lastAssistantText: "x", turnInStage: 1 });
    expect(answer.split(/\s+/).length).toBeGreaterThan(40);
    expect(answer).toMatch(/Kafka/);
  });

  it("pastes resume-ish content on the resume opener (still parseable)", () => {
    const persona = createMeanderingPersona();
    const answer = persona.answer({
      stage: "resume",
      lastAssistantText: "Have a resume handy? Paste/upload it — or skip, we already have plenty.",
      turnInStage: 1,
    });
    expect(answer).toContain("Alex Quinn");
  });

  it("confirms on the resume reflect-back, tangents and all", () => {
    const persona = createMeanderingPersona();
    const answer = persona.answer({
      stage: "resume",
      lastAssistantText: "Staff engineer, ~8 years, Go/Python — anything wrong or missing?",
      turnInStage: 2,
    });
    expect(answer.toLowerCase()).toMatch(/accurate|right|correct/);
  });

  it("still surfaces location and salary floor in a rambling logistics answer", () => {
    const persona = createMeanderingPersona();
    const answer = persona.answer({
      stage: "targeting",
      lastAssistantText: "Logistics, all in one go: where are you based, remote or hybrid, salary floor?",
      turnInStage: 1,
    });
    expect(answer).toMatch(/Denver/);
    expect(answer).toMatch(/175/);
    expect(answer.split(/\s+/).length).toBeGreaterThan(15);
  });

  it("gives distinct non-empty rambling answers per targeting topic", () => {
    const persona = createMeanderingPersona();
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
});
