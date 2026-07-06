import { describe, expect, it } from "vitest";
import { INTERVIEW_SYSTEM_PROMPT, INTERVIEW_TOOLS, SEEDED_GREETING } from "./interview";

describe("SEEDED_GREETING", () => {
  it("is the exact resume-first opening line Task 2's UI renders verbatim", () => {
    expect(SEEDED_GREETING).toBe(
      "Welcome. Paste your resume (or upload a .txt/.md) and we'll get through " +
        "this fast — a few pointed questions after, about five minutes total."
    );
  });

  it("asks for the resume directly — no pre-resume interest question", () => {
    expect(SEEDED_GREETING.toLowerCase()).not.toMatch(/sounds fun/);
    expect(SEEDED_GREETING.toLowerCase()).toContain("resume");
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — the old pre-resume 'woo woo' opener is gone", () => {
  it("has no pre-resume interest/energy exchange or OPENING stage", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).not.toMatch(/sounds fun/i);
    expect(INTERVIEW_SYSTEM_PROMPT).not.toMatch(/0\.\s*OPENING/i);
    expect(INTERVIEW_SYSTEM_PROMPT).not.toMatch(/follow up.{0,40}exactly once/i);
  });

  it("stage 1 explicitly states there is no pre-resume exchange", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/there is no pre-resume exchange/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — tone ban-list", () => {
  it("contains a literal ban-list of the forbidden words/phrases", () => {
    const lower = INTERVIEW_SYSTEM_PROMPT.toLowerCase();
    for (const word of ["passion", "dream", "journey", "fulfilling", "lights you up", "calling", "purpose"]) {
      expect(lower).toContain(word);
    }
  });

  it("bans exclamation marks and requires one-message-answerable questions", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/no exclamation marks/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/answerable in one short message/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — FIX-1: every non-terminal turn ends with a question", () => {
  it("contains a hard turn-structure rule requiring every turn to end with exactly one question", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/TURN-STRUCTURE RULE \(hard constraint\)/);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/must end with exactly one question/i);
  });

  it("forbids bare acknowledgment-only turns by name", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/standalone acknowledgment-only turns are forbidden/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toContain('"Good, moving on."');
    expect(INTERVIEW_SYSTEM_PROMPT).toContain('"Got it — locked in."');
  });

  it("bans empty messages explicitly", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/never return an empty message/i);
  });

  it("states advancing a stage is never itself a free turn", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/advancing to a new stage is never itself a free turn/i);
  });

  it("instructs record_resume and record_identity to ask the next stage's question in the SAME message", () => {
    const sameMessageInstances = INTERVIEW_SYSTEM_PROMPT.match(/in that SAME message immediately ask/gi) ?? [];
    expect(sameMessageInstances.length).toBeGreaterThanOrEqual(2);
  });

  it("instructs stage 3 sub-questions to acknowledge and ask the next question in the same message", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(
      /immediately ask the next question in the SAME message — never send the acknowledgment alone/i
    );
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — FIX-1: never re-ask resume-known fields", () => {
  it("contains a hard rule that name/role/employer/education/skills/location come from the resume", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/NEVER RE-ASK RESUME-KNOWN FIELDS \(hard constraint\)/);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/never ask the user for any of them again/i);
  });

  it("stage 2 explicitly forbids asking for the name/role/employer/education/skills already extracted", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(
      /Do NOT ask for their name, current\/last role, employer, education, or skills/i
    );
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — resume-first stage 1: reflect-back", () => {
  it("instructs reflecting back a compact summary ending with the exact correction prompt", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/REFLECT BACK/);
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("current/last role, years of experience, 3-4 core skills");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("— anything wrong or missing?");
  });

  it("bounds the reflect-back to one correction turn max (no looping)", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/one correction turn max/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — stage 2: batched logistics", () => {
  it("instructs ONE batched logistics turn, not four separate questions", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/ONE batched turn/);
    expect(INTERVIEW_SYSTEM_PROMPT).toContain(
      "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), " +
        "and what's the salary floor below which you won't even look?"
    );
  });

  it("keeps phone/LinkedIn/website/GitHub volunteer-only — never asked for", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/volunteer-only/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/never ask for them/i);
  });

  it("still forbids work-authorization/sponsorship/start-date/AI-policy questions (CRITICAL RULE)", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("CRITICAL RULE");
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/work authorization/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/visa sponsorship/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/start date/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/AI-policy/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/prior interviews/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — stage 3: exactly five pointed targeting questions", () => {
  it("asks exactly five questions, one per turn", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/exactly these five questions, one per turn/i);
  });

  it("instructs the direction question, forced choice with derived options, feeding tiers", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("DIRECTION");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("Pick, combine, or correct.");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("This answer feeds tiers.");
  });

  it("instructs the trade-off question, feeding thesis_summary", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("TRADE-OFF");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain(
      "Two postings, same title: {a context-appropriate contrast derived from their field"
    );
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("Which ranks higher for you, or genuinely no preference?");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("feeds thesis energy / term-group weighting in thesis_summary");
  });

  it("instructs the more-of/done-with question, feeding thesis energy signals", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("MORE-OF / DONE-WITH");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("name one thing you want more of, and one you're done with.");
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/work activities, not feelings/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("feeds thesis energy signals in thesis_summary");
  });

  it("instructs the blunt dealbreakers question, feeding hard_disqualifiers", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("DEALBREAKERS");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain(
      "Anything I should never show you — industries, company types, work setups?"
    );
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("feeds hard_disqualifiers");
  });

  it("instructs the optional companies seed, skippable with no follow-up, feeding dream_companies", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("OPTIONAL SEED");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("skippable, no follow-up if skipped");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("Any specific companies you'd want on the watchlist? Fine to skip.");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("feeds dream_companies");
  });
});

describe("record_identity tool schema — email comes from auth, not the model", () => {
  it("does not require email — only name is required, so the model isn't forced to invent one", () => {
    const recordIdentity = INTERVIEW_TOOLS.find((t) => t.name === "record_identity");
    expect(recordIdentity?.input_schema.required).toEqual(["name"]);
  });

  it("still allows email as an optional property — harmless if the model includes one, since handleTurn.ts overwrites it with the authenticated user's email regardless", () => {
    const recordIdentity = INTERVIEW_TOOLS.find((t) => t.name === "record_identity");
    const properties = recordIdentity?.input_schema.properties as Record<string, unknown> | undefined;
    expect(properties).toHaveProperty("email");
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — wrap-up", () => {
  it("instructs the wrap-up text to point the user at the feed's Run my hunt button (HNT-1: scoring is user-triggered, not daily cron)", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain('Head to your feed and hit "Run my hunt"');
  });
});
