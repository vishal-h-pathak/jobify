/**
 * V3A-B2 §2: the shared "the model never gets to assert something the user
 * didn't actually write" guard. Voice's `signature_phrases`, metrics'
 * `claims[].text`, and mirror's `quoted_phrases` are all server-verified as
 * a literal substring of the text the user actually supplied — not fuzzy,
 * not normalized. Anything that doesn't verify is dropped silently (never
 * thrown), per the design's "drop any that aren't" contract.
 */

/**
 * Exact (case-sensitive) substring check: does `haystack` contain `needle`
 * once both are trimmed? An empty or whitespace-only needle never counts as
 * verbatim, even against an empty haystack.
 */
export function isVerbatimSubstring(needle: string, haystack: string): boolean {
  const trimmedNeedle = needle.trim();
  if (trimmedNeedle.length === 0) return false;
  return haystack.trim().includes(trimmedNeedle);
}

/**
 * Keeps only the items whose `getText(item)` verifies as a verbatim
 * substring of `haystack`, preserving the original order.
 */
export function filterVerbatim<T>(items: T[], getText: (item: T) => string, haystack: string): T[] {
  return items.filter((item) => isVerbatimSubstring(getText(item), haystack));
}
