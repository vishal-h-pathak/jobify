# Task 1 report — moduleTurns.ts + verbatim helper + targeting trim

## What I implemented

### 1. `web/lib/onboarding/verbatim.ts` (new)

```ts
export function isVerbatimSubstring(needle: string, haystack: string): boolean
export function filterVerbatim<T>(items: T[], getText: (item: T) => string, haystack: string): T[]
```

- `isVerbatimSubstring`: trims both sides, case-sensitive `haystack.trim().includes(needle.trim())`.
  Empty/whitespace-only needle → `false` unconditionally (even against an empty haystack).
- `filterVerbatim`: keeps items whose `getText(item)` verifies, preserving order, dropping the
  rest silently (never throws).

### 2. `web/lib/anthropic/moduleTurns.ts` (new)

Three LLM-turn functions, same shape/style as `interview.ts` (`anthropicClient()` +
`ONBOARDING_MODEL`, walk `response.content` for `tool_use`, return `{...fields, usage}`):

```ts
export async function runVoiceIngestTurn(sample: string): Promise<VoiceTurnResult>
// VoiceTurnResult = { register, rhythm, words_used, words_avoided, signature_phrases, usage }

export async function runMetricsExtractionTurn(searchableText: string): Promise<MetricsExtractionResult>
// MetricsExtractionResult = { claims: MetricClaim[], usage }
// MetricClaim = { id, text, source: "cv"|"range"|"energy"|"anchor", has_number }

export async function runMirrorGenerationTurn(inputs: MirrorGenerationInput): Promise<MirrorGenerationResult>
// MirrorGenerationInput = { extractedSummary: string }
// MirrorGenerationResult = { paragraphs: [string, string], quoted_phrases: string[], usage }
```

Also exported: `VOICE_INGEST_SYSTEM_PROMPT`, `VOICE_INGEST_TOOLS`,
`METRICS_EXTRACTION_SYSTEM_PROMPT`, `METRICS_EXTRACTION_TOOLS`,
`MIRROR_GENERATION_SYSTEM_PROMPT`, `MIRROR_GENERATION_TOOLS` (mirroring `interview.ts`'s pattern
of exporting the constant alongside the runner, for test assertions and potential route reuse).

None of the three functions verbatim-filter their own output — that's explicitly left to the
route layer (Task 5), per the brief, because only the route has the raw source text
(`sample`, `searchableText`, the user's free-text answers) in scope.

Defensive extraction: a missing tool call or malformed field returns typed empty defaults
(`""`, `[]`, or `["", ""]` for the mirror's tuple) rather than throwing. `runMetricsExtractionTurn`
additionally filters out individual malformed claim entries (bad `source` enum, missing fields)
while keeping well-formed ones in the same array.

### 3. `interview.ts` targeting trim

- Targeting-stage archetype checklist: five archetypes → four (`a` DIRECTION, `b` TRADE-OFF,
  `c` MORE-OF/DONE-WITH, `d` OPTIONAL SEED); `(d) DEALBREAKERS` removed entirely, with an
  explicit new sentence "Dealbreakers are no longer asked here — the dealbreakers module owns
  that ground now."
- "Generation freedom never excuses a missing field" sentence: required-fields list trimmed from
  `tiers, hard_disqualifiers, soft_concerns, and thesis_summary` to `tiers and thesis_summary`.
- `record_targeting` tool schema: `required` trimmed from
  `["tiers", "hard_disqualifiers", "soft_concerns", "thesis_summary"]` to
  `["tiers", "thesis_summary"]`. The two fields remain as optional schema properties (harmless
  if the model still emits empty arrays) — `applyToolCalls.ts` was not touched, per the brief's
  explicit out-of-scope note (it already treats them as optional-with-empty-array-fallback).
- Judgment call (brief explicitly grants this): "ask 3-5 pointed questions" / "dropping the
  count as low as 3" no longer made sense against 4 archetypes (max achievable is 4, one
  question per archetype), so I changed both to "2-4" / "as low as 2" for internal coherence.

## Test results

```
web/lib/onboarding/verbatim.test.ts     13 tests — pass
web/lib/anthropic/moduleTurns.test.ts   10 tests — pass
web/lib/anthropic/interview.test.ts     38 tests — pass (7 new/adjusted)
```

Full suite: `npx vitest run` → **88 test files, 756 tests, all pass.**
`npx tsc --noEmit -p tsconfig.json` → clean, no errors.
`npx eslint <all touched files>` → clean, no output.
`bash scripts/scrub_gate.sh` → PASS (scans the whole working tree, not just tracked files, so
the new untracked files were covered before the first commit).

`moduleTurns.test.ts` mocks at the `./client` boundary (`vi.mock("./client", () => ({
anthropicClient: () => ({ messages: { create: createMock } }), ONBOARDING_MODEL: "..." }))`),
the same boundary style used elsewhere in the repo for testing consumers of `interview.ts`
(`app/api/settings/resume/route.test.ts` mocks `@/lib/anthropic/client`'s `ONBOARDING_MODEL`
alongside mocking `interview.ts` itself). Note: `interview.test.ts` itself never actually
exercises `runInterviewTurn`/`runCalibrationGeneration`/`runResumeExtractionTurn` end-to-end —
it only asserts on the exported prompt/tool constants; there was no existing precedent for a
direct unit test of a turn function's `response.content` extraction logic. I built the mocking
pattern by analogy from how consumer routes mock `interview.ts` and `@/lib/anthropic/client`
together — it generalized cleanly to three functions, no escalation needed.

Each `moduleTurns.test.ts` describe block asserts: the model call arguments (model, system
prompt identity, tools identity, message shape), the full extracted return shape including
`usage` passthrough, and a missing/malformed-tool-call case returning defaults instead of
throwing — plus one metrics-specific test that malformed individual claim entries are dropped
while well-formed ones survive, and one voice-specific test that `signature_phrases` is
returned un-filtered (confirming the route owns verbatim-filtering, not this function).

## Files changed

- `web/lib/onboarding/verbatim.ts` (new)
- `web/lib/onboarding/verbatim.test.ts` (new)
- `web/lib/anthropic/moduleTurns.ts` (new)
- `web/lib/anthropic/moduleTurns.test.ts` (new)
- `web/lib/anthropic/interview.ts` (edited: targeting-stage prompt + `record_targeting.required`)
- `web/lib/anthropic/interview.test.ts` (edited: 2 assertions updated for 2-4/four-archetype
  language, `record_targeting.required` updated, 2 new describe blocks added — one for the
  dealbreakers removal, one for the optional-but-not-required schema fields)

Commits:
- `469a06e` — verbatim helper + moduleTurns.ts
- `e3a5106` — interview.ts targeting trim + test updates

(Note: this file previously held a stale report from an earlier/different task-numbering plan
iteration — an INT-1 resume-first interview redesign — dated before the current
`task-1-brief.md`. That content has been fully replaced with this task's actual report.)

## Self-review

- **Completeness vs. brief:** all three function signatures, all three tool schemas (field
  names, types, `enum`, `maxItems`/`minItems`), and both return-shape contracts match the brief
  verbatim. `record_targeting`'s already-optional `hard_disqualifiers`/`soft_concerns` were
  confirmed unchanged as schema properties (brief flagged this as likely a no-op finding — it
  was already the required-list that needed trimming, which I did).
- **Quality / YAGNI:** kept `moduleTurns.ts` to exactly the three functions + their
  prompts/schemas/types, no extra helpers. `verbatim.ts` has only the two specified functions.
  No speculative abstractions (e.g. did not build a generic "tool-call extractor" helper shared
  across the three functions — each mirrors `interview.ts`'s existing per-function inline
  extraction style rather than introducing a new pattern this task wasn't asked to build).
- **Test realism:** tests assert on actual extracted field values from mocked `tool_use` blocks
  (not just "mock was called") — e.g. `runMetricsExtractionTurn`'s malformed-claim-filtering
  test constructs three claims (one well-formed, one bad enum, one missing a field) and asserts
  only the well-formed one survives, in place.
- **Scrub gate:** verified explicitly (`scripts/scrub_gate.sh` → PASS) before committing; all
  prompts use "the candidate" / "job-search targeting profile," never a name or "resume
  application" framing.
- **Ledger discipline:** not directly applicable to this task — `moduleTurns.ts` functions are
  pure LLM-turn wrappers with no DB access; `recordOnboardingTurn` ledger calls belong to the
  route layer (Task 5), consistent with how `runResumeExtractionTurn` (same shape, existing
  code) is ledgered by its caller rather than internally.

## Concerns / deviations

- **Judgment call flagged above:** changed "3-5 pointed questions" / "as low as 3" to "2-4" /
  "as low as 2" for coherence against the new 4-archetype checklist. The brief only explicitly
  called out adjusting the "dropping the count" phrase, not the "3-5" opening sentence, but
  leaving "3-5" in place would have been internally inconsistent (max achievable is now 4
  questions from 4 archetypes, one per archetype). Flagging this since it's a step beyond the
  brief's literal instruction, though within the judgment it explicitly grants.
- **`MirrorGenerationResult.paragraphs` typed as a strict `[string, string]` tuple** (not
  `string[]`), with `["", ""]` as the empty-default fallback, so Task 5's route gets a type-safe
  guarantee of exactly two paragraphs to index into. This is slightly more specific than the
  brief's inline shorthand `paragraphs: [string, string] (exactly 2 items)` might have left
  ambiguous (tuple type vs. just an array) — I read "exactly 2 items" as intent for a real tuple
  type, not just a runtime-shape comment.
- No other deviations from the brief's exact schemas/signatures noted.

## Review-fix addendum (commits after 469a06e/e3a5106)

Fixed two findings from a task-scoped review of the above work.

### 1. Mirror system prompt — incomplete question-mark ban (main finding)

`MIRROR_GENERATION_SYSTEM_PROMPT`'s TONE hard-rule previously read: "no exclamation marks
anywhere. End the second paragraph declaratively — a statement, never a question." That only
constrains how paragraph 2 *ends* — it does not ban a question mark occurring mid-paragraph or
anywhere in paragraph 1. The brief (`docs/superpowers/plans/2026-07-16-v3a-b2-llm-modules.md`,
Task 1, `runMirrorGenerationTurn` prompt spec) calls for "no exclamation marks; ends
declaratively, no question mark anywhere," with an explicit note that this text never passes
through `/turn`'s ends-with-a-question post-check — so for mirror the ban must be complete and
prompt-only (nothing in code validates it).

Changed the HARD RULE — TONE paragraph in `web/lib/anthropic/moduleTurns.ts` to:

> HARD RULE — TONE: no exclamation marks anywhere, and no question marks anywhere — not as
> rhetorical devices, not mid-paragraph, not at the end. Every sentence in both paragraphs is a
> statement; end the second paragraph declaratively too. This text is never shown to the model
> again for a follow-up turn, so there is nothing to ask; asking a question here, anywhere in
> either paragraph, is always wrong.

No test previously asserted on this exact substring (tests reference the exported
`MIRROR_GENERATION_SYSTEM_PROMPT` constant by identity, not by content match), so no test
updates were required for this change.

### 2. `runMetricsExtractionTurn` — server-side cap at 12 claims (minor, fixed)

The tool schema advertised `maxItems: 12` on `claims`, but nothing in
`runMetricsExtractionTurn` enforced that cap server-side if a model ignored the schema hint and
returned more than 12 well-formed claims. Added `.slice(0, 12)` after the existing
`isMetricClaim` filter:

```ts
if (Array.isArray(input.claims)) {
  claims = input.claims.filter(isMetricClaim).slice(0, 12);
}
```

Added a new test in `moduleTurns.test.ts` (`runMetricsExtractionTurn` describe block): 15
well-formed claims in → asserts `result.claims` has length 12 and equals the first 12 of the
input array.

### Test results

```
npx vitest run lib/anthropic/moduleTurns.test.ts
✓ lib/anthropic/moduleTurns.test.ts (11 tests) — 11 passed (was 10; +1 new cap test)

npx vitest run lib/anthropic/moduleTurns.test.ts lib/anthropic/interview.test.ts
✓ lib/anthropic/moduleTurns.test.ts (11 tests)
✓ lib/anthropic/interview.test.ts (38 tests)
Test Files  2 passed (2)
     Tests  49 passed (49)
```

### Files changed

- `web/lib/anthropic/moduleTurns.ts` — mirror TONE hard-rule reworded; `.slice(0, 12)` added to
  `runMetricsExtractionTurn`.
- `web/lib/anthropic/moduleTurns.test.ts` — new test: caps claims at 12 given 15 well-formed
  inputs.

Commit: review-fix commit on `feat/v3a-b2-llm` (separate from 469a06e/e3a5106, not an amend).

## Follow-up: prompt-content regression coverage (post-43b053b)

`43b053b` reworded `MIRROR_GENERATION_SYSTEM_PROMPT`'s TONE hard-rule to unambiguously ban
question marks anywhere in the mirror's two generated paragraphs (not just "ends
declaratively"). Review flagged that `moduleTurns.test.ts` never asserted on the actual
CONTENT of this prompt string — only that it's passed by identity to the mocked Anthropic
client. Since this constraint is prompt-only (no code validates the model's output for stray
question marks; the mirror route is exempt from `/turn`'s ends-with-a-question post-check by
design), a future edit could silently reintroduce ambiguous wording with nothing to catch it.

Added a new `describe("MIRROR_GENERATION_SYSTEM_PROMPT content")` block in
`web/lib/anthropic/moduleTurns.test.ts` with two regression tests:

```ts
expect(MIRROR_GENERATION_SYSTEM_PROMPT).toMatch(/no question marks anywhere/i);
expect(MIRROR_GENERATION_SYSTEM_PROMPT).toMatch(/no exclamation marks anywhere/i);
```

```
npx vitest run lib/anthropic/moduleTurns.test.ts
✓ lib/anthropic/moduleTurns.test.ts (13 tests) — 13 passed (was 11; +2 new prompt-content tests)
```

Commit: `6bda6cb` — "test(moduleTurns): assert MIRROR_GENERATION_SYSTEM_PROMPT bans
question/exclamation marks anywhere" (new commit, not an amend).
