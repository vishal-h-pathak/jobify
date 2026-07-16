/**
 * Metrics module writer. Like voice.ts, article-digest.md is written
 * wholesale (no section-merge concern, no `parseBody`/`receipt` pair here —
 * task 5's dedicated route owns request validation and receipt copy). This
 * module owns splitting mirror-derived metric claims by their human
 * confirmation marks and rendering the "confirmed vs. never use" guardrail
 * doc described in `onboarding/schema/markdown-files.md`.
 */
export interface MetricClaim {
  id: string;
  text: string;
  source: "cv" | "range" | "energy" | "anchor";
  has_number: boolean;
}

export interface MetricMark {
  id: string;
  confident: boolean;
}

export function splitMetricClaims(
  claims: MetricClaim[],
  marks: MetricMark[]
): { confirmed: MetricClaim[]; neverUse: MetricClaim[] } {
  const markById = new Map(marks.map((mark) => [mark.id, mark]));
  const confirmed: MetricClaim[] = [];
  const neverUse: MetricClaim[] = [];

  for (const claim of claims) {
    const mark = markById.get(claim.id);
    if (mark?.confident === true) {
      confirmed.push(claim);
    } else {
      // No matching mark is defensive-only (the route should validate full
      // coverage before calling this), but still resolves to "never use" —
      // an unconfirmed claim must never be treated as safe to cite.
      neverUse.push(claim);
    }
  }

  return { confirmed, neverUse };
}

function renderClaims(claims: MetricClaim[], emptyLine: string): string {
  if (claims.length === 0) return emptyLine;
  return claims.map((claim) => `- ${claim.text} (from ${claim.source})`).join("\n");
}

export function applyMetricsToDoc(
  doc: Record<string, string>,
  claims: MetricClaim[],
  marks: MetricMark[]
): Record<string, string> {
  const { confirmed, neverUse } = splitMetricClaims(claims, marks);

  const markdown = [
    "# Article digest",
    "",
    "## Confirmed metrics",
    "",
    renderClaims(confirmed, "- none confirmed yet"),
    "",
    "## Never use",
    "",
    renderClaims(neverUse, "- none held back"),
    "",
  ].join("\n");

  return { ...doc, "article-digest.md": markdown };
}
