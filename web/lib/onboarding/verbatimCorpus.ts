export interface SessionForVerbatimCorpus {
  messages: Array<{ role: string; content: string }>;
  extracted: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * 2026-07-21 fix: the verbatim-quote corpus used to be chat messages only
 * (`filterVerbatim` in the mirror generate route), so a candidate who
 * answered mostly via structured cards — not free-text chat — had almost
 * none of her own phrases in the corpus, and good LLM-picked quotes got
 * silently dropped for failing the verbatim check. This additively extends
 * the corpus with every user-authored free-text field held in
 * `session.extracted`: card free-text (anchor/trajectory), dealbreakers'
 * custom entries (chip-templated strings included — harmless in a
 * substring-match haystack), energy's two prose answers, calibration's
 * range statement, and the voice sample. Chat message text is never
 * removed, only added to.
 */
export function buildVerbatimCorpus(session: SessionForVerbatimCorpus): string {
  const parts: string[] = [
    (session.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n"),
  ];

  const extracted = session.extracted ?? {};

  const anchor = asRecord(extracted.anchor);
  if (typeof anchor.free_text === "string") parts.push(anchor.free_text);

  const trajectory = asRecord(extracted.trajectory);
  if (typeof trajectory.free_text === "string") parts.push(trajectory.free_text);

  const dealbreakers = asRecord(extracted.dealbreakers);
  parts.push(...asStringArray(dealbreakers.hard_disqualifiers));
  parts.push(...asStringArray(dealbreakers.soft_concerns));

  const energy = asRecord(extracted.energy);
  if (typeof energy.hours_disappear === "string") parts.push(energy.hours_disappear);
  if (typeof energy.kept_putting_off === "string") parts.push(energy.kept_putting_off);

  const calibration = asRecord(extracted.calibration);
  if (typeof calibration.range_statement === "string") parts.push(calibration.range_statement);

  const voice = asRecord(extracted.voice);
  if (typeof voice.sample === "string") parts.push(voice.sample);

  return parts.filter((p) => p.trim().length > 0).join("\n");
}
