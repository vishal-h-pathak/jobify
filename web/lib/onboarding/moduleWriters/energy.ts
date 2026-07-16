import { upsertMarkdownSection } from "./sectionHelpers";

export interface EnergyPayload {
  hours_disappear: string;
  kept_putting_off: string;
}

export function parseEnergyBody(body: unknown): { ok: true; data: EnergyPayload } | { ok: false; error: string } {
  const hoursDisappear = typeof (body as { hours_disappear?: unknown })?.hours_disappear === "string"
    ? (body as { hours_disappear: string }).hours_disappear.trim()
    : "";
  const keptPuttingOff = typeof (body as { kept_putting_off?: unknown })?.kept_putting_off === "string"
    ? (body as { kept_putting_off: string }).kept_putting_off.trim()
    : "";

  if (!hoursDisappear) {
    return { ok: false, error: "hours_disappear is required" };
  }
  if (!keptPuttingOff) {
    return { ok: false, error: "kept_putting_off is required" };
  }

  return { ok: true, data: { hours_disappear: hoursDisappear, kept_putting_off: keptPuttingOff } };
}

export function energyReceipt(): string {
  return "2 energy signals";
}

const HEADING = "## Energy signals";

export function applyEnergyToDoc(doc: Record<string, string>, data: EnergyPayload): Record<string, string> {
  const body = [
    `- Hours disappear: ${data.hours_disappear}`,
    `- Kept putting off: ${data.kept_putting_off}`,
  ].join("\n");
  const thesis = upsertMarkdownSection(doc["thesis.md"] ?? "", HEADING, body);
  return { ...doc, "thesis.md": thesis };
}
