/**
 * Mirror module writer: replaces only thesis.md's intro paragraphs with the
 * mirror-derived pair, preserving every existing `## ` section verbatim.
 *
 * `incrementalDoc.ts` is FROZEN this session (its `parseThesis`/
 * `setThesisIntro` helpers are private anyway), so this is a small,
 * self-contained reimplementation scoped to exactly what the mirror module
 * needs: swap the intro, leave the sections tail untouched.
 *
 * thesis.md's shape is:
 *   # Hunting thesis
 *
 *   {intro}
 *
 *   ## Heading
 *
 *   ...
 *
 *   ## Heading2
 *
 *   ...
 *
 * We only need the sections tail (everything from the first `## ` heading
 * onward) — the old intro itself is discarded, not reused. Per the plan,
 * this deliberately avoids a whole-file regex scan: find the first
 * `\n## ` (or start-of-string `## `) index and slice, rather than matching
 * `/^##\s+/m` against the entire markdown.
 */
export function setThesisIntroFromMirror(markdown: string, paragraphs: [string, string]): string {
  const joined = paragraphs.join("\n\n");
  const source = markdown ?? "";

  let tailStart: number;
  if (source.startsWith("## ")) {
    tailStart = 0;
  } else {
    const idx = source.indexOf("\n## ");
    tailStart = idx === -1 ? -1 : idx + 1;
  }

  if (tailStart === -1) {
    // No `## ` heading at all (empty/malformed thesis.md) — nothing to
    // preserve, just the fresh intro.
    return `# Hunting thesis\n\n${joined}\n`;
  }

  const tail = source.slice(tailStart);
  return `# Hunting thesis\n\n${joined}\n\n${tail}`;
}
