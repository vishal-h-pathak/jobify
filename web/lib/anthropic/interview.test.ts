import { describe, expect, it } from "vitest";
import { INTERVIEW_SYSTEM_PROMPT, SEEDED_GREETING } from "./interview";

describe("SEEDED_GREETING", () => {
  it("is the exact opening line Task 2's UI renders verbatim", () => {
    expect(SEEDED_GREETING).toBe(
      "Hey — welcome. I'm going to build your job-hunting profile with you. " +
        "Before the paperwork: what do you do, and what kind of work actually " +
        "sounds fun right now?"
    );
  });
});

describe("INTERVIEW_SYSTEM_PROMPT", () => {
  it("instructs a single follow-up on interests/energy before pivoting to the resume ask", () => {
    // The pre-resume exchange (reacting to the seeded greeting) must be
    // bounded to exactly one follow-up turn, not an open-ended interrogation.
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/follow up.{0,40}exactly once/i);
    expect(INTERVIEW_SYSTEM_PROMPT.toLowerCase()).toContain("paste your resume");
  });

  it("still forbids work-authorization/sponsorship/start-date/AI-policy questions (CRITICAL RULE)", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("CRITICAL RULE");
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/work authorization/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/visa sponsorship/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/start date/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/AI-policy/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/prior interviews/i);
  });

  it("instructs weaving pre-resume interests/energy signals into thesis_summary, not a new tool field", () => {
    expect(INTERVIEW_SYSTEM_PROMPT.toLowerCase()).toContain("thesis_summary");
    expect(INTERVIEW_SYSTEM_PROMPT.toLowerCase()).toMatch(/interests?|energy/);
  });

  it("instructs one-topic-per-turn reflective questioning for identity/targeting", () => {
    expect(INTERVIEW_SYSTEM_PROMPT.toLowerCase()).toMatch(/one topic per turn/);
  });

  it("instructs the wrap-up text to point the user at the feed's Run my hunt button (HNT-1: scoring is user-triggered, not daily cron)", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain('Head to your feed and hit "Run my hunt"');
  });
});
