import { upsertMarkdownSection, bulletList } from "./sectionHelpers";

// session-prompts/31_v3a_modules.md task 2: four either-or scenarios,
// defined server-side so the payload validates against a known key set.
export const ENVIRONMENT_SCENARIOS = [
  { key: "team_size", a: "Small team (fewer than 10)", b: "Large team or org (10+)" },
  { key: "pace", a: "Fast, ship-and-iterate", b: "Deliberate, high-review" },
  { key: "ambiguity", a: "Comfortable figuring out ambiguity", b: "Prefers clear specs and defined scope" },
  { key: "management_appetite", a: "Wants to manage people eventually", b: "Wants to stay individual-contributor" },
] as const;

const SCENARIO_KEYS = ENVIRONMENT_SCENARIOS.map((scenario) => scenario.key);

export type EnvironmentPayload = Record<(typeof SCENARIO_KEYS)[number], "a" | "b">;

export function parseEnvironmentBody(
  body: unknown
): { ok: true; data: EnvironmentPayload } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be an object of scenario picks" };
  }
  const record = body as Record<string, unknown>;
  const data = {} as EnvironmentPayload;
  for (const key of SCENARIO_KEYS) {
    const choice = record[key];
    if (choice !== "a" && choice !== "b") {
      return { ok: false, error: `${key} must be "a" or "b"` };
    }
    data[key] = choice;
  }
  return { ok: true, data };
}

export function environmentReceipt(): string {
  return `${SCENARIO_KEYS.length} scenarios chosen`;
}

const HEADING = "## Environment preferences";

export function applyEnvironmentToDoc(doc: Record<string, string>, data: EnvironmentPayload): Record<string, string> {
  const chosenLabels = ENVIRONMENT_SCENARIOS.map((scenario) => (data[scenario.key] === "a" ? scenario.a : scenario.b));
  const thesis = upsertMarkdownSection(doc["thesis.md"] ?? "", HEADING, bulletList(chosenLabels));
  return { ...doc, "thesis.md": thesis };
}
