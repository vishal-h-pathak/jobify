import { describe, expect, it } from "vitest";
import { createCorrectivePersona } from "./corrective";

describe("createCorrectivePersona", () => {
  it("answers calibration and resume normally, like the cooperative baseline", () => {
    const persona = createCorrectivePersona();
    const calibration = persona.answer({ stage: "calibration", lastAssistantText: "x", turnInStage: 1 });
    expect(calibration.trim().length).toBeGreaterThan(0);

    const resume = persona.answer({
      stage: "resume",
      lastAssistantText: "Have a resume handy? Paste/upload it — or skip, we already have plenty.",
      turnInStage: 1,
    });
    expect(resume).toContain("Alex Quinn");
  });

  it("gives the logistics answer with the original salary floor on the first targeting turn", () => {
    const persona = createCorrectivePersona();
    const answer = persona.answer({
      stage: "targeting",
      lastAssistantText: "Logistics, all in one go: where are you based, remote or hybrid, salary floor?",
      turnInStage: 1,
    });
    expect(answer).toMatch(/Denver/);
    expect(answer).toMatch(/175/);
    expect(answer.toLowerCase()).not.toContain("correction");
  });

  it("the owner's real mid-interview self-correction move: corrects the salary floor on the very next targeting turn, exactly once", () => {
    const persona = createCorrectivePersona();
    persona.answer({
      stage: "targeting",
      lastAssistantText: "Logistics, all in one go: where are you based, remote or hybrid, salary floor?",
      turnInStage: 1,
    });

    const second = persona.answer({ stage: "targeting", lastAssistantText: "Which next-role direction fits?", turnInStage: 2 });
    expect(second.toLowerCase()).toContain("correction");
    expect(second).toMatch(/190/); // the corrected floor
    expect(second.toLowerCase()).toMatch(/platform|infra/); // still answers the actual question asked

    const third = persona.answer({ stage: "targeting", lastAssistantText: "Two postings — which ranks higher?", turnInStage: 3 });
    expect(third.toLowerCase()).not.toContain("correction");
  });

  it("never issues the correction before logistics has been answered", () => {
    // Defensive: if the model somehow asks a non-logistics targeting
    // question first (out-of-order), the correction must not fire before
    // there's anything to correct.
    const persona = createCorrectivePersona();
    const first = persona.answer({ stage: "targeting", lastAssistantText: "Which next-role direction fits?", turnInStage: 1 });
    expect(first.toLowerCase()).not.toContain("correction");
  });
});
