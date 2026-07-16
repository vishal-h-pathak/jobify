import { describe, expect, it } from "vitest";
import { applyVoiceToDoc, type VoiceProfileData } from "./voice";

const fullData: VoiceProfileData = {
  register: "Direct, low-formality, technical",
  rhythm: "Short declarative sentences, occasional fragments",
  words_used: ["shipped", "gnarly", "systems-level"],
  words_avoided: ["synergy", "leverage (as a verb)"],
  signature_phrases: ["let's ship it", "worth the squeeze"],
};

const emptyData: VoiceProfileData = {
  register: "Neutral",
  rhythm: "Even",
  words_used: [],
  words_avoided: [],
  signature_phrases: [],
};

describe("applyVoiceToDoc", () => {
  it("is pure: does not mutate the input doc", () => {
    const doc = { "voice-profile.md": "" };
    const before = { ...doc };
    applyVoiceToDoc(doc, fullData);
    expect(doc).toEqual(before);
  });

  it("preserves other doc keys untouched", () => {
    const doc = { "voice-profile.md": "old", "thesis.md": "# Hunting thesis\n" };
    const result = applyVoiceToDoc(doc, fullData);
    expect(result["thesis.md"]).toBe("# Hunting thesis\n");
  });

  it("renders all five headings, locking in the validator's at-least-one-heading requirement", () => {
    const result = applyVoiceToDoc({}, fullData);
    const text = result["voice-profile.md"];
    expect(/^## /m.test(text)).toBe(true);
    expect(text).toContain("## Register");
    expect(text).toContain("## Rhythm");
    expect(text).toContain("## Words used");
    expect(text).toContain("## Words avoided");
    expect(text).toContain("## Signature phrases");
  });

  it("renders populated register/rhythm and bulleted word/phrase lists", () => {
    const result = applyVoiceToDoc({}, fullData);
    const text = result["voice-profile.md"];
    expect(text).toContain("Direct, low-formality, technical");
    expect(text).toContain("Short declarative sentences, occasional fragments");
    expect(text).toContain("- shipped");
    expect(text).toContain("- gnarly");
    expect(text).toContain("- systems-level");
    expect(text).toContain("- synergy");
    expect(text).toContain("- leverage (as a verb)");
    expect(text).toContain("- let's ship it");
    expect(text).toContain("- worth the squeeze");
  });

  it("renders '- (none noted)' for each empty array section instead of a blank body", () => {
    const result = applyVoiceToDoc({}, emptyData);
    const text = result["voice-profile.md"];
    const noneNotedCount = text.split("- (none noted)").length - 1;
    expect(noneNotedCount).toBe(3);
  });

  it("always full-replaces on re-submission (no merge/append behavior)", () => {
    let doc: Record<string, string> = { "voice-profile.md": "# Voice profile\n\nstale content" };
    doc = applyVoiceToDoc(doc, fullData);
    expect(doc["voice-profile.md"]).not.toContain("stale content");
    expect(doc["voice-profile.md"].match(/# Voice profile/g)).toHaveLength(1);
  });
});
