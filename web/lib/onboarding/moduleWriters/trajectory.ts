import { upsertMarkdownSection } from "./sectionHelpers";

export type TrajectoryDirection = "climb" | "switch" | "stabilize" | "experiment";

const DIRECTIONS: TrajectoryDirection[] = ["climb", "switch", "stabilize", "experiment"];

// The one-line tier hint each direction implies for the hunter/tailor —
// kept as prose in thesis.md rather than a profile.yml tier mutation
// (tiers stay owned by the anchor/targeting flow).
const TIER_HINTS: Record<TrajectoryDirection, string> = {
  climb: "Prioritize senior/staff-tier roles at the same or larger scope.",
  switch: "Open to adjacent-domain tiers, not just same-title roles.",
  stabilize: "Same rung, better terms — do not downshift tier for comp or brand.",
  experiment: "Open to non-traditional or early-stage tiers.",
};

export interface TrajectoryPayload {
  direction: TrajectoryDirection;
  free_text?: string;
}

export function parseTrajectoryBody(
  body: unknown
): { ok: true; data: TrajectoryPayload } | { ok: false; error: string } {
  const direction = (body as { direction?: unknown })?.direction;
  if (typeof direction !== "string" || !DIRECTIONS.includes(direction as TrajectoryDirection)) {
    return { ok: false, error: `direction must be one of: ${DIRECTIONS.join(", ")}` };
  }
  const freeTextRaw = (body as { free_text?: unknown })?.free_text;
  const freeText = typeof freeTextRaw === "string" ? freeTextRaw.trim() : "";

  return {
    ok: true,
    data: { direction: direction as TrajectoryDirection, ...(freeText ? { free_text: freeText } : {}) },
  };
}

export function trajectoryReceipt(data: TrajectoryPayload): string {
  return `trajectory: ${data.direction}`;
}

const HEADING = "## Trajectory";

export function applyTrajectoryToDoc(doc: Record<string, string>, data: TrajectoryPayload): Record<string, string> {
  const lines = [`- Direction: ${data.direction}`, `- Tier hint: ${TIER_HINTS[data.direction]}`];
  if (data.free_text) lines.push(`- In their words: ${data.free_text}`);
  const thesis = upsertMarkdownSection(doc["thesis.md"] ?? "", HEADING, lines.join("\n"));
  return { ...doc, "thesis.md": thesis };
}
