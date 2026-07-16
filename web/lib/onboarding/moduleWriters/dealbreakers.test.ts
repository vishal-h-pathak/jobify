import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { applyDealbreakersToDoc, dealbreakersReceipt, parseDealbreakersBody } from "./dealbreakers";

describe("parseDealbreakersBody", () => {
  it("rejects a non-array hard_disqualifiers", () => {
    expect(parseDealbreakersBody({ hard_disqualifiers: "Crypto" }).ok).toBe(false);
  });

  it("rejects a blank entry in hard_disqualifiers", () => {
    expect(parseDealbreakersBody({ hard_disqualifiers: ["Crypto", "  "] }).ok).toBe(false);
  });

  it("rejects a non-array soft_concerns when provided", () => {
    expect(parseDealbreakersBody({ hard_disqualifiers: [], soft_concerns: "meh" }).ok).toBe(false);
  });

  it("accepts an empty hard_disqualifiers list (no dealbreakers is a valid signal)", () => {
    const result = parseDealbreakersBody({ hard_disqualifiers: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ hard_disqualifiers: [], soft_concerns: [] });
  });

  it("defaults soft_concerns to [] when omitted", () => {
    const result = parseDealbreakersBody({ hard_disqualifiers: ["Crypto / Web3"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.soft_concerns).toEqual([]);
  });

  it("trims entries in both lists", () => {
    const result = parseDealbreakersBody({ hard_disqualifiers: [" Crypto / Web3 "], soft_concerns: [" Early-stage "] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hard_disqualifiers).toEqual(["Crypto / Web3"]);
      expect(result.data.soft_concerns).toEqual(["Early-stage"]);
    }
  });
});

describe("dealbreakersReceipt", () => {
  it("reports the hard_disqualifiers count", () => {
    expect(dealbreakersReceipt({ hard_disqualifiers: ["a", "b"], soft_concerns: [] })).toBe("2 dealbreakers");
  });
});

describe("applyDealbreakersToDoc", () => {
  const data = { hard_disqualifiers: ["Crypto / Web3"], soft_concerns: ["Very early-stage"] };

  it("is pure: does not mutate the input doc", () => {
    const doc = { "disqualifiers.yml": "" };
    const before = { ...doc };
    applyDealbreakersToDoc(doc, data);
    expect(doc).toEqual(before);
  });

  it("writes both arrays into disqualifiers.yml", () => {
    const result = applyDealbreakersToDoc({ "disqualifiers.yml": "" }, data);
    const parsed = yaml.load(result["disqualifiers.yml"]) as Record<string, unknown>;
    expect(parsed.hard_disqualifiers).toEqual(["Crypto / Web3"]);
    expect(parsed.soft_concerns).toEqual(["Very early-stage"]);
  });

  it("re-submission replaces the arrays wholesale, not merges them", () => {
    let doc: Record<string, string> = { "disqualifiers.yml": "" };
    doc = applyDealbreakersToDoc(doc, data);
    doc = applyDealbreakersToDoc(doc, { hard_disqualifiers: ["Defense contractors"], soft_concerns: [] });
    const parsed = yaml.load(doc["disqualifiers.yml"]) as Record<string, unknown>;
    expect(parsed.hard_disqualifiers).toEqual(["Defense contractors"]);
    expect(parsed.soft_concerns).toEqual([]);
  });

  it("preserves any other existing top-level key in the file", () => {
    const existing = yaml.dump({ hard_disqualifiers: [], soft_concerns: [], extra_note: "keep me" });
    const result = applyDealbreakersToDoc({ "disqualifiers.yml": existing }, data);
    const parsed = yaml.load(result["disqualifiers.yml"]) as Record<string, unknown>;
    expect(parsed.extra_note).toBe("keep me");
  });

  it("leaves other doc files untouched", () => {
    const doc = { "disqualifiers.yml": "", "thesis.md": "keep me" };
    const result = applyDealbreakersToDoc(doc, data);
    expect(result["thesis.md"]).toBe("keep me");
  });
});
