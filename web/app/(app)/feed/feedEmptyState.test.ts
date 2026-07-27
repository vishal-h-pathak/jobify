import { describe, expect, it } from "vitest";
import { deriveFeedEmptyState } from "./feedEmptyState";

describe("deriveFeedEmptyState", () => {
  it("returns null when the user has any matches (nothing empty to show)", () => {
    expect(deriveFeedEmptyState({ totalMatches: 1, rejectedLlmCount: 5 })).toBeNull();
  });

  it("never-hunted user (zero matches, zero rejected_llm) gets the generic 'Nothing yet' copy", () => {
    const state = deriveFeedEmptyState({ totalMatches: 0, rejectedLlmCount: 0 });
    expect(state).toEqual({
      heading: "Nothing yet",
      message: 'Your profile is built — the hunter runs when you ask. Hit "Run my hunt" above to get your first results.',
    });
  });

  it("hunted-but-nothing-cleared-the-bar user gets honest quality-floor copy naming the count", () => {
    const state = deriveFeedEmptyState({ totalMatches: 0, rejectedLlmCount: 3 });
    expect(state?.heading).toBe("Nothing worth showing yet");
    expect(state?.message).toContain("3");
    expect(state?.message).toContain("didn't clear your bar");
  });
});
