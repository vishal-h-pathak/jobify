import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { applyLogisticsToDoc } from "./applyLogisticsToDoc";

function loadProfile(doc: Record<string, string>): Record<string, unknown> {
  return yaml.load(doc["profile.yml"]) as Record<string, unknown>;
}

describe("applyLogisticsToDoc", () => {
  it("sets identity.location_and_compensation on an empty doc", () => {
    const next = applyLogisticsToDoc({}, { base: "Atlanta, GA" });
    const profile = loadProfile(next);
    expect(profile.identity).toEqual({ name: "", email: "", location_and_compensation: { base: "Atlanta, GA" } });
  });

  it("merges into an existing location_and_compensation without dropping untouched fields", () => {
    const doc = {
      "profile.yml": yaml.dump({
        identity: {
          name: "Alex Quinn",
          email: "alex@example.com",
          location_and_compensation: { base: "Atlanta, GA", current_comp_usd: 165000 },
        },
      }),
    };

    const next = applyLogisticsToDoc(doc, { remote_acceptable: true, target_comp_usd: "180000+" });
    const profile = loadProfile(next);

    expect(profile.identity).toEqual({
      name: "Alex Quinn",
      email: "alex@example.com",
      location_and_compensation: {
        base: "Atlanta, GA",
        current_comp_usd: 165000,
        remote_acceptable: true,
        target_comp_usd: "180000+",
      },
    });
  });

  it("overwrites a patched key rather than accumulating duplicates", () => {
    const doc = {
      "profile.yml": yaml.dump({
        identity: { name: "Alex Quinn", email: "a@example.com", location_and_compensation: { base: "Old City" } },
      }),
    };

    const next = applyLogisticsToDoc(doc, { base: "Atlanta, GA" });

    expect(loadProfile(next).identity).toMatchObject({ location_and_compensation: { base: "Atlanta, GA" } });
  });

  it("leaves every other doc file untouched", () => {
    const doc = { "profile.yml": "identity: {}\n", "thesis.md": "# Hunting thesis\n\nSomething." };
    const next = applyLogisticsToDoc(doc, { base: "Atlanta, GA" });
    expect(next["thesis.md"]).toBe(doc["thesis.md"]);
  });
});
