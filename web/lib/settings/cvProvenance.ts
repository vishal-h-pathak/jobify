/**
 * Mirrors the leading heading `buildDoc.ts`'s `buildSynthesizedCv` writes
 * when the resume stage was skipped (web/lib/profile/buildDoc.ts:168) — that
 * heading doubles as a provenance marker per its own comment. Duplicated
 * here (not imported) because web/lib/profile/** is consume-only for this
 * session; a real uploaded/extracted resume never starts with this line.
 */
const SYNTHESIZED_CV_MARKER = "# CV — assembled from onboarding interview";

export type CvProvenance = "resume" | "interview" | "none";

export function deriveCvProvenance(doc: Record<string, string> | null | undefined): CvProvenance {
  const cvMarkdown = doc?.["cv.md"];
  if (!cvMarkdown || !cvMarkdown.trim()) return "none";
  return cvMarkdown.startsWith(SYNTHESIZED_CV_MARKER) ? "interview" : "resume";
}
