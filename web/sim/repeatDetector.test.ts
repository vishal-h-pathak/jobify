import { describe, expect, it } from "vitest";
import { normalizeAssistantText, findRepeatedWindow, checkNoRepeatInvariant } from "./repeatDetector";

describe("normalizeAssistantText", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeAssistantText("Logistics, all in ONE go:  where are you based?")).toBe(
      "logistics all in one go where are you based"
    );
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeAssistantText("  Hi there.  ")).toBe("hi there");
  });
});

describe("findRepeatedWindow", () => {
  const FALLBACK =
    "logistics all in one go where are you based remote only or is some onsite fine and where " +
    "and whats the salary floor below which you wont even look";

  it("finds no repeat between two genuinely different questions", () => {
    const result = findRepeatedWindow(
      ["tell me about a hard bug you fixed recently and how you approached it"],
      "which of these two directions would you pick first for your next role"
    );
    expect(result.repeated).toBe(false);
  });

  it("flags a shared 12+-word window even when the surrounding text differs (the real loop shape)", () => {
    const prior = "got it logistics locked in already thanks " + FALLBACK;
    const candidate = "understood appreciate the details " + FALLBACK;

    const result = findRepeatedWindow([prior], candidate);
    expect(result.repeated).toBe(true);
    expect(result.matchedTurnIndex).toBe(0);
  });

  it("does not flag two short (<12-word) turns that happen to share a few words", () => {
    const result = findRepeatedWindow(["got it thanks for that"], "got it makes sense, what next");
    expect(result.repeated).toBe(false);
  });

  it("flags two short turns that are exactly identical (whole-text duplicate)", () => {
    const result = findRepeatedWindow(["noted, thanks"], "noted, thanks".toLowerCase());
    expect(result.repeated).toBe(true);
  });

  it("never flags an empty candidate against an empty prior", () => {
    const result = findRepeatedWindow([""], "");
    expect(result.repeated).toBe(false);
  });
});

describe("checkNoRepeatInvariant", () => {
  it("passes a clean, non-repeating transcript", () => {
    const result = checkNoRepeatInvariant([
      "Have a resume handy? Paste/upload it — or skip, we already have plenty.",
      "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), and what's the salary floor below which you won't even look?",
      "Which of these two directions would you pick first for your next role?",
    ]);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  // Abridged reproduction of the first live loop (handleTurn.ts's FIX-1
  // comment): the context-blind targeting opener kept getting re-appended
  // turn after turn because the post-check couldn't tell logistics had
  // already landed. This transcript must FAIL — proving the detector
  // catches it.
  it("FAILS on an abridged reproduction of live loop #1 (context-blind targeting re-ask)", () => {
    const fallback =
      "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), " +
      "and what's the salary floor below which you won't even look?";
    const result = checkNoRepeatInvariant([
      "Got it — appreciate the background. " + fallback,
      "Thanks, noted. " + fallback,
      "Understood. " + fallback,
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  // Abridged reproduction of the second live loop (handleTurn.ts's v2
  // comment): before the continue-reprompt fix, an ack-only turn's exact
  // wording repeated verbatim because the model imitated the pattern it
  // saw in its own prior turn. Must also FAIL.
  it("FAILS on an abridged reproduction of live loop #2 (ack-only self-imitation)", () => {
    const result = checkNoRepeatInvariant([
      "Got it — that gives real shape to direction. Which of those directions would you pick first?",
      "Good, moving on — that gives real shape to direction. Which of those directions would you pick first?",
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("reports the offending turn indices in a failure", () => {
    const fallback =
      "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), " +
      "and what's the salary floor below which you won't even look?";
    const result = checkNoRepeatInvariant(["intro line, unrelated", fallback, "acknowledged. " + fallback]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toMatchObject({ turnIndex: 2, matchedTurnIndex: 1 });
  });
});
