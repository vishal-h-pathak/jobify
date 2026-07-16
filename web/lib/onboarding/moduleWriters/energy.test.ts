import { describe, expect, it } from "vitest";
import { applyEnergyToDoc, energyReceipt, parseEnergyBody } from "./energy";

describe("parseEnergyBody", () => {
  it("rejects a missing hours_disappear", () => {
    const result = parseEnergyBody({ kept_putting_off: "Expense reports" });
    expect(result.ok).toBe(false);
  });

  it("rejects a blank kept_putting_off", () => {
    const result = parseEnergyBody({ hours_disappear: "Debugging", kept_putting_off: "   " });
    expect(result.ok).toBe(false);
  });

  it("accepts both trimmed free-text answers", () => {
    const result = parseEnergyBody({ hours_disappear: " Debugging prod issues ", kept_putting_off: "Expense reports" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hours_disappear).toBe("Debugging prod issues");
      expect(result.data.kept_putting_off).toBe("Expense reports");
    }
  });
});

describe("energyReceipt", () => {
  it("is a fixed two-signal receipt", () => {
    expect(energyReceipt()).toBe("2 energy signals");
  });
});

describe("applyEnergyToDoc", () => {
  const data = { hours_disappear: "Debugging", kept_putting_off: "Expense reports" };

  it("is pure: does not mutate the input doc", () => {
    const doc = { "thesis.md": "" };
    const before = { ...doc };
    applyEnergyToDoc(doc, data);
    expect(doc).toEqual(before);
  });

  it("renders both answers into thesis.md under Energy signals", () => {
    const result = applyEnergyToDoc({ "thesis.md": "" }, data);
    expect(result["thesis.md"]).toContain("## Energy signals");
    expect(result["thesis.md"]).toContain("Debugging");
    expect(result["thesis.md"]).toContain("Expense reports");
  });

  it("re-submission replaces the section instead of duplicating it", () => {
    let doc: Record<string, string> = { "thesis.md": "" };
    doc = applyEnergyToDoc(doc, data);
    doc = applyEnergyToDoc(doc, { hours_disappear: "Design reviews", kept_putting_off: "Invoicing" });
    expect(doc["thesis.md"].match(/## Energy signals/g)).toHaveLength(1);
    expect(doc["thesis.md"]).toContain("Design reviews");
    expect(doc["thesis.md"]).not.toContain("Debugging");
  });
});
