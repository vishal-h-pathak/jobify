/**
 * Idempotent markdown-section upsert shared by every module writer that
 * appends into `thesis.md`. A module owns exactly one `## heading` — a
 * re-submission replaces that heading's own body (up to the next `## `
 * heading or end of file) rather than appending a duplicate section.
 */
export function upsertMarkdownSection(markdown: string, heading: string, body: string): string {
  const trimmedBody = body.trim();
  const block = `${heading}\n\n${trimmedBody}\n`;
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === heading.trim());

  if (headingIndex === -1) {
    const base = markdown.trim();
    return (base ? `${base}\n\n${block}` : `${block}`).trim() + "\n";
  }

  let endIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ") || lines[i].startsWith("# ")) {
      endIndex = i;
      break;
    }
  }

  const before = lines.slice(0, headingIndex).join("\n").trim();
  const after = lines.slice(endIndex).join("\n").trim();
  const parts = [before, block.trim(), after].filter(Boolean);
  return parts.join("\n\n").trim() + "\n";
}

/** Renders `label` / `notes` bullet lists shared by the trade-off + scenario writers. */
export function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}
