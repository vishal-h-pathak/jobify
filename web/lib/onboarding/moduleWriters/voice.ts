/**
 * Voice module writer. Unlike the phase-1 structured modules (energy,
 * values, ...), voice-profile.md has no section-merge concern — the whole
 * file is written in one shot, once, from the mirror-derived voice profile.
 * There is no `parseBody`/`receipt` pair here (task 5's dedicated route
 * owns request validation and receipt copy); this module only owns the
 * pure doc-rendering step.
 */
export interface VoiceProfileData {
  register: string;
  rhythm: string;
  words_used: string[];
  words_avoided: string[];
  signature_phrases: string[];
}

function renderList(items: string[], emptyLine: string): string {
  if (items.length === 0) return emptyLine;
  return items.map((item) => `- ${item}`).join("\n");
}

export function applyVoiceToDoc(doc: Record<string, string>, data: VoiceProfileData): Record<string, string> {
  const markdown = [
    "# Voice profile",
    "",
    "## Register",
    "",
    data.register,
    "",
    "## Rhythm",
    "",
    data.rhythm,
    "",
    "## Words used",
    "",
    renderList(data.words_used, "- (none noted)"),
    "",
    "## Words avoided",
    "",
    renderList(data.words_avoided, "- (none noted)"),
    "",
    "## Signature phrases",
    "",
    renderList(data.signature_phrases, "- (none noted)"),
    "",
  ].join("\n");

  return { ...doc, "voice-profile.md": markdown };
}
