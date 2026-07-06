import yaml from "js-yaml";

/**
 * ONB-A decision #3: the sanctioned exception to profile.yml/cv.md's
 * "code never overwrites after the initial write" rule (buildDoc.ts's
 * header). Given a resume uploaded after onboarding (skipped or not),
 * rewrites ONLY cv.md and, if trivially derivable, profile.yml's
 * background_summary — every other file and every other profile.yml field
 * is left byte-for-byte untouched. The settings-UI route that reads the
 * user's profiles row, calls this, and writes the result back (plus any
 * ledger accounting for the extraction call) is a separate session's job;
 * this ships the helper + its real extraction call only.
 */
export interface ResumeExtraction {
  cv_markdown: string;
  background_summary?: string;
}

export interface RegenerateCvDeps {
  runExtraction: (resumeText: string) => Promise<ResumeExtraction>;
}

/**
 * profile.yml's leading run of `#` comment lines (and blank lines) is the
 * hand-written header documenting the file's contract — not YAML data, so
 * js-yaml's parse/dump round-trip would silently drop it. Split it off,
 * re-parse only the real YAML body, and re-attach the same header verbatim
 * so a background_summary rewrite doesn't erase the file's own
 * documentation of what a rewrite is allowed to touch.
 */
function splitHeader(profileYamlText: string): { header: string; body: string } {
  const lines = profileYamlText.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("#") || lines[i].trim() === "")) i++;
  return { header: lines.slice(0, i).join("\n"), body: lines.slice(i).join("\n") };
}

function rewriteBackgroundSummary(profileYamlText: string, backgroundSummary: string): string {
  const { header, body } = splitHeader(profileYamlText);
  const parsed = ((yaml.load(body) as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  parsed.background_summary = backgroundSummary;
  return header + yaml.dump(parsed, { noRefs: true, lineWidth: -1 });
}

export async function regenerateCv(
  doc: Record<string, string>,
  resumeText: string,
  deps: RegenerateCvDeps
): Promise<Record<string, string>> {
  const extraction = await deps.runExtraction(resumeText);

  const updated: Record<string, string> = { ...doc, "cv.md": extraction.cv_markdown };
  if (extraction.background_summary) {
    updated["profile.yml"] = rewriteBackgroundSummary(doc["profile.yml"] ?? "", extraction.background_summary);
  }

  return updated;
}
