# V3A-B2 — voice/metrics/mirror LLM modules

Source: `planning/session-prompts/34_v3a_b2_llm_modules.md`, `planning/V3A_DESIGN.md` §2 (+ §1.7,
§4), `planning/PRODUCT_VISION.md` §2 items 10-12. Branch `feat/v3a-b2-llm` off `feat/v3a`,
worktree `jobify-wt/v3a-b2-llm`. Push when done; do NOT merge.

## Global constraints (every task)

- Scrub gate: zero operator-identifying strings anywhere. Prompts say "the candidate", never a
  real name/company. This is enforced by CI; do not introduce literal PII tokens even in test
  fixtures/comments.
- `ModuleKey` union (`web/lib/onboarding/moduleRegistry.ts`) is FROZEN — 12 keys, no "targeting"
  key exists. Do not add one. `checkpoint.ts` and `incrementalDoc.ts` are FROZEN — do not edit
  either file this session.
- Every LLM call goes through `anthropicClient()`/`ONBOARDING_MODEL` (`web/lib/anthropic/client.ts`)
  and writes exactly one `budget_ledger` row via `recordOnboardingTurn` (`web/lib/db/ledger.ts`).
- Auth gate on every new route, copied verbatim from `web/app/api/onboarding/modules/[key]/route.ts`:
  sign-in required (401), then `isAdmin(user) || hasClaimedInvite(supabase)` (403 otherwise).
- Module completion sequence (already the pattern in every existing module route): write
  `extracted[key]`, call `markModuleComplete(session, key, receipt)`, persist via `saveSession`,
  apply `applyToDoc`/moduleWriter output to the doc only if `getProfileDoc` returns non-null,
  `upsertProfileDoc` when it does. Voice/metrics/mirror do NOT call `maybeFireCheckpoint` —
  phase 1 has always completed by the time they run (canonical order), and `checkpoint.ts` is
  frozen/out of scope.
- Style: reducer-based panels (`phase: "editing"|"submitting"|"error"|"finished"`), `fetchImpl`
  DI defaulting to `fetch`, `useEffect` firing `onComplete()` on `phase === "finished"` — copy
  `web/components/onboarding/EnergyPanel.tsx` / `DealbreakersPanel.tsx` structure.
- Tests colocated `*.test.ts(x)`, vitest, mirroring existing onboarding test style (mock at the
  `lib/db/*` / `lib/supabase/*` boundary, not deeper).

---

## Task 0 — MANDATORY: cross-route phase-1 checkpoint integration test

Write a new test file
`web/app/api/onboarding/__tests__/phase1CheckpointIntegration.test.ts` that drives the FOUR real
phase-1 route handlers — `POST` from `web/app/api/onboarding/anchor/route.ts`,
`web/app/api/onboarding/modules/reactions/route.ts`, and `web/app/api/onboarding/modules/[key]/route.ts`
(called with `key="values"` and `key="dealbreakers"`) — with **fakes only at the DB/dispatch
boundary**, exercising the REAL `moduleRegistry.ts` (`markModuleComplete`, `phaseOneComplete`)
and the REAL `checkpoint.ts` (`maybeFireCheckpoint`) unmocked. This is the gap: every existing
per-route test mocks `moduleRegistry`/`checkpoint` away, so no test has ever exercised the real
completion-sequence logic across all four routes together.

**Fakes to build (in the test file, no new production files):**
- Mock `@/lib/supabase/server` → `createSupabaseServerClient` returns an object with
  `auth.getUser()` (fixed user `{id: "user-1"}`) and a `.from(table)` chain covering exactly
  what `reactions/route.ts`'s POST path calls: `.from("postings").select(...).eq("id", id).maybeSingle()`
  → looks up a seeded in-memory `postings` array by id; `.from("posting_reactions").upsert(...)`
  → no-op `{error: null}`. A small `chain(result)` helper works: every chain method
  (`select`/`eq`/`neq`/`gte`/`order`/`limit`/`upsert`/`update`) returns the same object, which is
  also thenable (`then(resolve) { resolve(result); }`) and has `maybeSingle: async () => result`.
  You do not need the reactions GET path (`sampleReactionPostings`) — only POST is exercised.
- Mock `@/lib/supabase/admin` → `createSupabaseAdminClient` returns a similar fake exposing
  `.from("profiles")` (`.select("user_id").eq(...).maybeSingle()` → `{data: null, error: null}`
  meaning no pre-existing profile row, and `.upsert(...)` → `{error: null}`) and
  `.from("onboarding_sessions")` (`.update(...).eq(...)` → `{error: null}`) — this is what
  `checkpoint.ts`'s `maybeFireCheckpoint` calls directly on `deps.admin`.
- Mock `@/lib/db/invites` (`hasClaimedInvite` → `true`) and `@/lib/admin/isAdmin` (→ `false`).
- Mock `@/lib/db/onboardingSession`: `getOrCreateSession`/`saveSession` backed by ONE shared
  mutable in-memory record per test (`{user_id: "user-1", stage: "anchor", messages: [],
  extracted: {}, modules: {}, status: "in_progress"}`), so completions accumulate correctly
  across all four route calls within a test — `saveSession` does `Object.assign(store, updates)`.
- Mock `@/lib/db/profiles`: `getProfileDoc` → always `null` (no profiles row exists client-side
  yet — realistic, since `checkpoint.ts` itself is what creates the row, via the admin client,
  not this wrapper); `upsertProfileDoc` → unused no-op spy.
- Mock `@/lib/onboarding/checkpointDeps`'s `buildCheckpointDeps` to return
  `{ admin: <the fake admin client above>, dispatchHunt: <vi.fn spy resolving {}>, cooldownHours: 6,
  githubRepo: undefined, githubToken: undefined, fetchImpl: fetch, now: () => new Date("2026-07-16T00:00:00.000Z") }`.
  Do NOT mock `@/lib/onboarding/checkpoint` itself — its real `maybeFireCheckpoint` must run.
  Do NOT mock `@/lib/onboarding/moduleRegistry` or `@/lib/onboarding/incrementalDoc` — real code.

**Seed data:** an in-memory `postings` array of at least 6 objects
`{id: "posting-1".."posting-6", title: "Staff Engineer", company: "Acme"}` (fictional, no real
company/person names — scrub gate).

**Test bodies (two `it`s, or a `describe.each` over both orders):**
1. **"anchor-first"**: call anchor POST (zero-LLM form payload, e.g.
   `{current_title: "Staff Engineer", current_company: "Acme"}`), then reactions POST six times
   (distinct `posting_id`s from the seed, alternating `interested`/`not_interested`), then values
   POST (6 of the 7 `VALUE_PAIRS` ids from `moduleWriters/values.ts`, any valid `choice`), then
   dealbreakers POST (`{hard_disqualifiers: ["defense"], soft_concerns: []}`). Assert the
   `dispatchHunt` spy is called **zero times** after each of the first three calls, and exactly
   **once** total after the dealbreakers call (the one that completes phase 1 last in this
   order).
2. **"anchor-last"**: same four calls, reordered reactions → values → dealbreakers → anchor.
   Assert `dispatchHunt` is called zero times after the first three, and exactly once total
   after the anchor call (the one that completes phase 1 last in THIS order). This is the
   ordering most likely to reveal a route that marks its own module but never calls the
   checkpoint.
3. In both tests, additionally re-POST dealbreakers a second time after all four are complete
   (a redo/resubmit) and assert `dispatchHunt` is STILL called exactly once total — idempotency
   across repeat calls, not just across the four distinct modules.

**Expected finding:** read `web/app/api/onboarding/anchor/route.ts` — as of this session it
calls `markModuleComplete` but never `maybeFireCheckpoint`. If the "anchor-last" test fails
because of this (checkpoint never fires when anchor is the module that completes phase 1), fix
`anchor/route.ts` to call `maybeFireCheckpoint` after `saveSession`, in exactly the same pattern
already used in `web/app/api/onboarding/modules/reactions/route.ts` (after the reaction-count
threshold completes the module): build deps via `buildCheckpointDeps()` and await
`maybeFireCheckpoint(deps, { ...session, extracted: session.extracted, modules }, user)`. This
file is not otherwise in this session's ownership list, but this fix is the direct, minimal
resolution of the mandatory debt task — do not expand it further (no other changes to
anchor/route.ts). If your test does NOT reveal this gap (e.g. you find anchor already calls the
checkpoint), do not force a change — just confirm the test still asserts the exactly-once
property meaningfully (it must be RED before any fix and GREEN after, for at least one of the
two orderings, to prove it isn't vacuous).

**Report:** state which ordering (if either) required the `anchor/route.ts` fix, and paste the
before/after test result for that ordering.

---

## Task 1 — `moduleTurns.ts` + verbatim helper + targeting trim

### 1a. `web/lib/onboarding/verbatim.ts` (new, pure, unit-tested)

One shared helper used by voice/metrics/mirror to enforce "the model never gets to assert
something the user didn't actually write":

```ts
export function isVerbatimSubstring(needle: string, haystack: string): boolean
export function filterVerbatim<T>(items: T[], getText: (item: T) => string, haystack: string): T[]
```

`isVerbatimSubstring`: trims both, case-sensitive substring check (`haystack.includes(needle.trim())`)
— exact verbatim, not fuzzy/normalized (the design's repeated "server-verified as a substring"
language means literal). Empty/whitespace-only needle → `false`. `filterVerbatim` keeps only
items whose text passes `isVerbatimSubstring`, dropping the rest (silently — the design's
"drop any that aren't" contract, not an error).

### 1b. `web/lib/anthropic/moduleTurns.ts` (new)

Three LLM turn functions, same shape as `runInterviewTurn`/`runCalibrationGeneration` in
`web/lib/anthropic/interview.ts` (read that file first — reuse `anthropicClient()`,
`ONBOARDING_MODEL`, the `{assistantText, toolCalls, usage}` extraction pattern from
`response.content`). Prompts refer to "the candidate" — never a name, never "you're building a
resume", the framing is a job-search *targeting* profile, matching `INTERVIEW_SYSTEM_PROMPT`'s
opening framing.

**`runVoiceIngestTurn(sample: string): Promise<VoiceTurnResult>`**
System prompt (verbatim rules, write it out in full, do not abbreviate — this is what ships):
forced tool call `record_voice`, descriptive never evaluative ("plainspoken, short sentences",
never "good writer"), no personality inference, no grading. Tool schema:
```
record_voice { register: string, rhythm: string, words_used: string[], words_avoided: string[], signature_phrases: string[] }
```
all fields required except none optional (all required — the design's five sections all need
content). Single user turn: pass `sample` as the only message. Extract the tool call the same
way `runCalibrationGeneration` does (loop `response.content`, find `block.type === "tool_use" &&
block.name === "record_voice"`). Return
`{register, rhythm, words_used, words_avoided, signature_phrases, usage}` — do NOT filter
`signature_phrases` here; verbatim-filtering against `sample` happens in the ROUTE (task 5),
using `filterVerbatim` from 1a, because the route is what has `sample` in scope for the doc
writer too. (Rationale: keep this function a pure LLM-turn wrapper, same shape as the others.)

**`runMetricsExtractionTurn(searchableText: string): Promise<MetricsExtractionResult>`**
`searchableText` is the ALREADY-ASSEMBLED corpus (cv.md + every relevant extracted field + every
user chat message — assembly happens in the route, task 5, per the owner decision "metrics sweep
EVERYTHING": chat text is in scope, not just cv/resume). System prompt: forced tool
`record_metric_claims`, `text` must be verbatim from the inputs, only quantifiable/outcome
claims, max 12, never invented, `source` one of `cv|range|energy|anchor`. Tool schema:
```
record_metric_claims { claims: [{ id: string, text: string, source: "cv"|"range"|"energy"|"anchor", has_number: boolean }] }
```
(`id` — short stable string the model assigns, e.g. `"claim_1"`; array `maxItems: 12`.) Single
user turn passing `searchableText`. Return `{claims, usage}` — again, do not verbatim-filter
here (route's job, since it owns `searchableText` too and this keeps the two verbatim-filter
call sites — voice and metrics — symmetric).

**`runMirrorGenerationTurn(inputs: MirrorGenerationInput): Promise<MirrorGenerationResult>`**
`MirrorGenerationInput` = `{ extractedSummary: string }` (route assembles a readable-text
summary of the full `extracted` state + current doc — pass as the one user message; do not
over-design the summary format, plain labeled sections is fine, e.g. "Anchor: ...\nValues:
...\nEnergy: ..."). System prompt (constitutional, write in full): exactly two paragraphs,
second person, ≤180 words total; must weave in at least two verbatim phrases the user actually
wrote (returned in `quoted_phrases`); never diagnoses/labels — explicit ban list: personality
types, "perfectionist", "type-A", "introvert"/"extrovert", any trait noun not evidenced by the
inputs; never states a fact absent from inputs; no exclamation marks; ends declaratively, no
question mark anywhere (this text never passes through the `/turn` post-check, so the ban is
prompt-level only, and that's by design — do not add a question). Tool schema:
```
record_mirror { paragraphs: [string, string] (exactly 2 items), quoted_phrases: string[] }
```
Return `{paragraphs, quoted_phrases, usage}`. The route (task 5) verbatim-filters
`quoted_phrases` against the user's own free-text answers and, per the design, regenerates once
on a failure (< 2 verbatim quotes survive), then degrades to fewer quotes rather than fabricate
— that retry loop lives in the ROUTE (it needs the ledger-row-per-turn accounting), this function
is called twice by the route in that case.

### 1c. `interview.ts` targeting trim

Edit `INTERVIEW_SYSTEM_PROMPT` in `web/lib/anthropic/interview.ts`, stage 3 (TARGETING)
paragraph only. Per V3A_DESIGN.md §1.7: "dealbreakers module owns filters now — targeting stops
asking them." Remove archetype (d) DEALBREAKERS from the "coverage checklist of five archetypes"
(renumber the remaining to a..d, drop to 4 archetypes, adjust "dropping the count as low as 3"
language if it no longer makes sense against 4 — use judgment, keep the sentence coherent).
Remove `hard_disqualifiers`/`soft_concerns` from the "Generation freedom never excuses a missing
field" sentence's required-fields list (now just `tiers` and `thesis_summary`). In the
`record_targeting` tool schema (`INTERVIEW_TOOLS`), you may leave `hard_disqualifiers` /
`soft_concerns` as optional schema fields (harmless if the model still emits empty arrays) but
remove them from `required` if they're there (check first — they may already be optional).
Do NOT touch `applyToolCalls.ts`'s handling of `record_targeting` (it already treats those
fields as optional-with-empty-array-fallback) — that file is out of this task's scope. Do not
touch any other stage's prompt text.

**Tests:** `web/lib/onboarding/verbatim.test.ts` (pure function tests — exact substring, trimmed
whitespace, case sensitivity, empty needle, filterVerbatim drops correctly, preserves order).
`web/lib/anthropic/moduleTurns.test.ts` mocking `anthropicClient()` the same way
`interview.test.ts` does (read that file for the exact mocking pattern) — one test per function
asserting the tool name, that usage tokens pass through, and that a missing/malformed tool call
returns sensible empty defaults (not a throw). Add/adjust one assertion in `interview.test.ts`
confirming the targeting-stage prompt no longer asks about dealbreakers (e.g.
`expect(INTERVIEW_SYSTEM_PROMPT).not.toMatch(/dealbreakers.{0,40}(bluntly|industries)/i)` or
similar — pick a robust assertion against your actual edited text) and that `record_targeting`'s
required list no longer includes `hard_disqualifiers`/`soft_concerns` if you changed it.

---

## Task 2 — `moduleRegistry.ts` receipt internals

Smallest sanctioned touch: replace `noExtractorYet` with real receipt functions for exactly
`range`, `evidence`, `voice`, `metrics`, `mirror` in `web/lib/onboarding/moduleRegistry.ts`. Do
NOT touch the `ModuleKey` union, `ModuleDefinition`/`ModulesState` interfaces, `markModuleComplete`,
`phaseOneComplete`, or any other exported signature — purely swapping five `receipt` function
bodies in the `MODULE_REGISTRY` object literal, same pattern as the existing `anchorReceipt`/
`valuesReceipt`/etc. above them in the file.

```ts
function rangeReceipt(extracted: Record<string, unknown>): string | null {
  const calibration = extracted.calibration as { skills?: unknown; evidence?: unknown } | undefined;
  if (!calibration) return null;
  return "4 answers";
}

function evidenceReceipt(extracted: Record<string, unknown>): string | null {
  const resume = extracted.resume as { cv_markdown?: unknown } | undefined;
  if (resume && typeof resume.cv_markdown === "string" && resume.cv_markdown.trim()) return "resume added";
  const calibration = extracted.calibration as { evidence?: unknown } | undefined;
  if (calibration) return "built from your answers";
  return null;
}

function voiceReceipt(extracted: Record<string, unknown>): string | null {
  const voice = extracted.voice as { register?: unknown } | undefined;
  const register = typeof voice?.register === "string" ? voice.register.trim() : "";
  return register ? `voice: ${register}` : null;
}

function metricsReceipt(extracted: Record<string, unknown>): string | null {
  const metrics = extracted.metrics as { confirmed?: unknown; never_use?: unknown } | undefined;
  if (!metrics) return null;
  const confirmed = Array.isArray(metrics.confirmed) ? metrics.confirmed.length : 0;
  const heldBack = Array.isArray(metrics.never_use) ? metrics.never_use.length : 0;
  return `${confirmed} confirmed · ${heldBack} held back`;
}

function mirrorReceipt(extracted: Record<string, unknown>): string | null {
  const mirror = extracted.mirror as { quoted_phrases?: unknown } | undefined;
  if (!mirror) return null;
  const n = Array.isArray(mirror.quoted_phrases) ? mirror.quoted_phrases.length : 0;
  return `${n} verbatim quote${n === 1 ? "" : "s"}`;
}
```

Wire these into the `MODULE_REGISTRY` literal in place of the current `noExtractorYet` entries
for those five keys (`anchor`/`reactions`/`values`/`dealbreakers`/`energy`/`environment`/
`trajectory` keep their existing receipt functions untouched).

**Why `range`/`evidence` derive from `extracted` rather than take a literal string:** task 4
(handleTurn glue) will call `MODULE_REGISTRY.range.receipt(extracted)` /
`MODULE_REGISTRY.evidence.receipt(extracted)` after merging the tool-call result into
`extracted`, the same pattern `anchor/route.ts` already uses
(`MODULE_REGISTRY.anchor.receipt(anchor)`) — this keeps the receipt string derivation in one
place instead of hardcoding it at each call site.

**Tests:** extend `web/lib/onboarding/moduleRegistry.test.ts` with one `describe` block per new
receipt function — null on missing/empty data, the real string on populated data, matching the
existing test style for `anchorReceipt`/`valuesReceipt` etc. in that same file (read it first).

---

## Task 3 — `moduleWriters/{voice,metrics,mirror}.ts`

Same file shape as `moduleWriters/energy.ts` (read it — parse-ish helpers + a receipt-adjacent
concern + one `applyXToDoc(doc, data) -> doc` pure function each), but these three are NOT
registered into `MODULE_WRITERS`/`STRUCTURED_MODULE_KEYS` in `moduleWriters/index.ts` — leave
that file untouched. Voice/metrics/mirror have their own dedicated routes (task 5), which import
these functions directly.

**`web/lib/onboarding/moduleWriters/voice.ts`**
```ts
export interface VoiceProfileData {
  register: string; rhythm: string;
  words_used: string[]; words_avoided: string[]; signature_phrases: string[];
}
export function applyVoiceToDoc(doc: Record<string, string>, data: VoiceProfileData): Record<string, string>
```
Writes `doc["voice-profile.md"]` wholesale (voice is one-shot, no re-submission/section-merge
concern — always full replace) as:
```
# Voice profile

## Register

{register}

## Rhythm

{rhythm}

## Words used

- {word}
...（or "- (none noted)" if empty）

## Words avoided

- {word}
...

## Signature phrases

- {phrase}
...
```
(Five `## ` headings — `validateProfileDoc` requires at least one; give it all five verbatim,
matching the design's "those five sections".) Empty arrays render a single `- (none noted)` line
rather than an empty section body.

**`web/lib/onboarding/moduleWriters/metrics.ts`**
```ts
export interface MetricClaim { id: string; text: string; source: "cv" | "range" | "energy" | "anchor"; has_number: boolean; }
export interface MetricMark { id: string; confident: boolean; }
export function applyMetricsToDoc(doc: Record<string, string>, claims: MetricClaim[], marks: MetricMark[]): Record<string, string>
export function splitMetricClaims(claims: MetricClaim[], marks: MetricMark[]): { confirmed: MetricClaim[]; neverUse: MetricClaim[] }
```
`splitMetricClaims`: for each claim, find its mark by `id`; `confident: true` → confirmed,
anything else (including a claim with NO matching mark — defensive, should not happen if the
route validates coverage) → neverUse. `applyMetricsToDoc` calls `splitMetricClaims` then writes
`doc["article-digest.md"]` wholesale as:
```
# Article digest

## Confirmed metrics

- {text} (from {source})
...(or "- none confirmed yet" if empty)

## Never use

- {text} (from {source})
...(or "- none held back" if empty)
```
(Matches `onboarding/schema/markdown-files.md`'s expectation of a "do not invent" guardrail
section — "Never use" is that section.)

**`web/lib/onboarding/moduleWriters/mirror.ts`**
```ts
export function setThesisIntroFromMirror(markdown: string, paragraphs: [string, string]): string
```
`incrementalDoc.ts` is FROZEN (do not import/edit it) — `parseThesis`/`setThesisIntro` there are
private anyway. Reimplement locally, small and self-contained: `thesis.md`'s shape is
`# Hunting thesis\n\n{intro}\n\n## Heading\n\n...\n\n## Heading2\n\n...`. Find the first line
matching `/^##\s+/m` in `markdown`; everything before it (after stripping a leading `# ` title
line if present) is the old intro, everything from that match onward is preserved verbatim as
the sections tail. Rebuild as `# Hunting thesis\n\n{joined paragraphs}\n\n{preserved tail}`
(paragraphs joined with a blank line between them). If `markdown` has no `## ` heading at all
(edge case, e.g. an empty/malformed thesis.md), just return
`# Hunting thesis\n\n{joined paragraphs}\n`. Do not use regex against the WHOLE file greedily —
find the first `\n## ` (or start-of-string `## `) index and slice.

**Tests:** one `*.test.ts` per file, covering: empty/populated data renders correctly, headings
present (assert `/^## /m.test(result["voice-profile.md"])` etc. to lock in the validator
requirement), `splitMetricClaims` correctly buckets by mark, `setThesisIntroFromMirror` preserves
an existing `## Hard constraints` section untouched while replacing only the intro (this is the
critical regression this function exists to prevent — write a test with a realistic thesis.md
fixture containing 2+ sections and assert both survive byte-for-byte after the intro swap).

---

## Task 4 — `handleTurn.ts` glue

Read `web/lib/onboarding/handleTurn.ts` and `handleTurn.test.ts` in full first (already read by
the controller — the existing test suite's exact mock shape for `saveSession`/`upsertProfileDoc`/
`recordOnboardingTurn` must keep passing unmodified except where a test's assertions are
extended, never contradicted).

**1. `SessionSnapshot` gains a `modules` field:**
```ts
import type { ModulesState } from "./moduleRegistry";
export interface SessionSnapshot {
  stage: InterviewStage;
  messages: ChatMessage[];
  extracted: ExtractedState;
  status: "in_progress" | "complete";
  modules: ModulesState;
}
```
The one call site that constructs this object for `handleOnboardingTurn` —
`web/app/api/onboarding/turn/route.ts` — needs `modules: (session.modules ?? {}) as ModulesState`
added to its `session: {...}` object literal. (`web/lib/onboarding/maybeGenerateCalibration.ts`
has its own separate, smaller `CalibrationSessionSnapshot` type with no `modules` field and never
calls `handleOnboardingTurn` — it is NOT a call site for this change; do not touch that file.)
`saveSession`'s `Update` type already accepts a `modules` field (every other module route already
passes it) so no `db/onboardingSession.ts` change is needed.

**2. Inside `handleOnboardingTurn`, after `applyToolCalls` runs** (right after the line
`const { extracted, stage, done } = applyToolCalls(...)`), compute the updated `modules`:

```ts
import { markModuleComplete, MODULE_REGISTRY, type ModulesState } from "./moduleRegistry";

let modules: ModulesState = session.modules;
const firedCalibration = turnResult.toolCalls.some((c) => c.name === "record_calibration");
const firedResume = turnResult.toolCalls.some((c) => c.name === "record_resume");
if (firedCalibration) {
  const receipt = MODULE_REGISTRY.range.receipt(extracted as unknown as Record<string, unknown>);
  if (receipt) modules = markModuleComplete({ modules }, "range", receipt);
}
if (firedResume) {
  const receipt = MODULE_REGISTRY.evidence.receipt(extracted as unknown as Record<string, unknown>);
  if (receipt) modules = markModuleComplete({ modules }, "evidence", receipt);
}
```
(`{ modules }` as the first arg matches `markModuleComplete`'s signature
`(session: { modules: ModulesState }, key, receipt)` — it only reads `.modules`, chain multiple
calls by threading the local `modules` variable through, same as every existing route.)

**3. The resume-skip branch** (the early-return block at the top of `handleOnboardingTurn` for
`session.stage === "resume" && userMessage === RESUME_SKIP_MESSAGE`): after building
`newMessages`, also mark evidence complete —
`extracted.resume` is NOT set on this path (that's exactly why the receipt fn returns "built
from your answers" here — it falls through to the calibration-present branch since `resume` is
absent). Compute
`const modules = markModuleComplete({ modules: session.modules }, "evidence", "built from your answers");`
unconditionally (skip is always a valid completion of the evidence module) and pass
`modules` into the `saveSession` call in that branch (currently it only passes
`{messages, extracted, stage, status}` — add `modules`).

**4. Persist `modules` in BOTH `saveSession` calls at the bottom of the main function** (the
`done` branch and the `else` branch) — add `modules` to both update objects, using the `modules`
local variable computed in step 2 (untouched from `session.modules` if neither tool call fired
this turn — always pass it through so a later turn's read of `session.modules` via
`getOrCreateSession` stays accurate even on turns that mark nothing).

**5. Do NOT** call `maybeFireCheckpoint` here (phase 1 is already long complete by the time the
interview block runs; `checkpoint.ts` is frozen/out of scope) and do NOT add a third
`markModuleComplete` call for `finish_interview` — there is no `"targeting"` `ModuleKey`;
`finish_interview` closes the block via the existing `stage`/`status` transition only, exactly
as V3A_DESIGN.md §1.7 specifies ("finish_interview closes the block" — no additional module
mark).

**Tests:** extend `handleTurn.test.ts`. New cases: (a) a turn whose tool call is
`record_calibration` results in `saveSession` being called with
`modules: expect.objectContaining({ range: expect.objectContaining({ receipt: "4 answers" }) })`;
(b) a turn whose tool call is `record_resume` results in `modules.evidence.receipt === "resume
added"`; (c) the resume-skip path results in `modules.evidence.receipt === "built from your
answers"`; (d) a turn that fires neither tool preserves `session.modules` unchanged in the
`saveSession` call (pass a non-empty `modules` fixture into `baseSession` overrides and assert
it round-trips). Do not remove or weaken any existing assertion in this file.

---

## Task 5 — voice/metrics/mirror routes

Five new route files, each following the exact auth-gate + session-load pattern of
`web/app/api/onboarding/modules/[key]/route.ts` (read it again — `createSupabaseServerClient`,
`getUser`, `isAdmin`/`hasClaimedInvite` gate, `getOrCreateSession`, `getProfileDoc`/
`upsertProfileDoc` guarded by `if (profileDoc)`). Every LLM-calling route also calls
`recordOnboardingTurn(admin, {...})` — `admin = createSupabaseAdminClient()` — exactly once per
Anthropic call (mirror's regenerate path calls it twice across two requests, once per request,
never twice in one request).

**`web/app/api/onboarding/modules/voice/route.ts`** — `POST { sample: string }`.
400 if `sample` missing/blank. Call `runVoiceIngestTurn(sample)`. Record ledger row. Verbatim-
filter `signature_phrases` against `sample` via `filterVerbatim` (task 1a). Build
`VoiceProfileData` from the (filtered) turn result, save `extracted.voice = data` (plus keep
`data.sample = sample` in the stored `extracted.voice` per the design — "Sample itself stored in
`extracted.voice.sample` for the dossier" — so the stored shape is `{...data, sample}`, but
`applyVoiceToDoc` only takes the five fields, not `sample`). Receipt:
`MODULE_REGISTRY.voice.receipt({voice: data})`. `markModuleComplete` → `saveSession`. If
`getProfileDoc` returns non-null, `applyVoiceToDoc` + `upsertProfileDoc`. Return
`{ok: true, key: "voice", receipt}`.

**`web/app/api/onboarding/modules/metrics/extract/route.ts`** — `POST` (no body). Assemble
`searchableText` from: `getProfileDoc(supabase, user.id)?.doc["cv.md"] ?? ""`, plus
`session.extracted.calibration?.evidence` (join with newlines) and
`session.extracted.calibration?.range_statement`, plus
`session.extracted.energy?.hours_disappear` / `?.kept_putting_off`, plus
`session.extracted.anchor?.free_text` / `?.current_title` / `?.current_company`, plus — per the
owner decision "metrics sweep EVERYTHING" — every `session.messages` entry with `role ===
"user"` (their raw `.content`), all newline-joined into one big text blob (order doesn't matter,
it's only used for substring containment checks downstream). Call
`runMetricsExtractionTurn(searchableText)`. Record ledger row. Verbatim-filter `claims` (via
`filterVerbatim`, `getText: c => c.text`) against `searchableText`. Store
`extracted.metrics = { claims: filteredClaims }` in the session (do NOT mark the module complete
— this is the pre-marking extraction step). Return `{claims: filteredClaims}`. No
`markModuleComplete` call in this route.

**`web/app/api/onboarding/modules/metrics/route.ts`** — `POST { marks: {id: string, confident:
boolean}[] }` (zero-LLM). Read `session.extracted.metrics?.claims` — 400 if absent (extract
step never ran) or if `marks` doesn't cover exactly the same id set as `claims` (every claim id
present in `marks` exactly once, no unknown ids — 400 with a clear error otherwise, matching the
strict-validation style of `moduleWriters/dealbreakers.ts::parseDealbreakersBody`). Call
`splitMetricClaims(claims, marks)` (task 3), store
`extracted.metrics = { claims, confirmed: <ids or full claims — use the same MetricClaim[] shape
as splitMetricClaims returns for confirmed/neverUse, stored as confirmed/never_use arrays> }`.
Receipt: `MODULE_REGISTRY.metrics.receipt({metrics: {confirmed, never_use: neverUse}})`.
`markModuleComplete` → `saveSession`. `applyMetricsToDoc(doc, claims, marks)` +
`upsertProfileDoc` when a profile doc exists. Return `{ok: true, key: "metrics", receipt}`.

**`web/app/api/onboarding/modules/mirror/generate/route.ts`** — `POST` (no body). Assemble
`extractedSummary` (task 1b's input) from `session.extracted` — plain labeled-sections text is
fine, keep it simple (e.g. join non-empty top-level pieces: anchor, values choices, energy
answers, environment choices, trajectory, calibration evidence/range_statement, targeting
thesis_summary if present — whatever's populated; do not error on missing pieces).

Track one counter in the session, `session.extracted.mirror_generation_count` (number, default
0) — this is the single budget for BOTH the design's "regenerate once on a low-quote failure"
and the UI's "Try again (one regen max)"; they are the same budget, not additive, so every
`runMirrorGenerationTurn` call this route makes increments the same counter regardless of what
triggered it. Logic:
1. Call `runMirrorGenerationTurn(extractedSummary)`. Record a ledger row. Increment the counter
   by 1. Verbatim-filter `quoted_phrases` against the concatenation of every `session.messages`
   entry with `role === "user"` (their free-text answers — same corpus philosophy as metrics,
   but simpler: just the chat text, not cv.md).
2. If fewer than 2 phrases survive AND the counter is still `< 2` after step 1, retry
   automatically: call `runMirrorGenerationTurn` again, record a second ledger row, increment
   the counter again, re-filter. (This auto-retry only ever fires from a fresh "generate" click,
   never from a "Try again" click that immediately follows one — see step 0 below.)
3. If the counter was already `>= 2` when this route was invoked (i.e. a "Try again" click after
   the budget is spent — whether spent by two manual clicks or one manual click plus one
   auto-retry), skip calling `runMirrorGenerationTurn` entirely: no new ledger row, return the
   existing `extracted.mirror_draft` unchanged. Do not 409 — a stale draft is fine, the user can
   still accept or edit it.
4. Store the latest result as `extracted.mirror_draft = {paragraphs, quoted_phrases}` (not
   marked complete) and the updated counter, via `saveSession`. Return `{paragraphs,
   quoted_phrases}`.

**`web/app/api/onboarding/modules/mirror/accept/route.ts`** — `POST { paragraphs: [string,
string] }` (the possibly-user-edited final text — do NOT read from `mirror_draft` server-side,
trust the client's submitted paragraphs, since the design explicitly allows inline editing
before accept). 400 if not exactly 2 non-empty strings. Zero-LLM. `quoted_phrases` for the
receipt/stored record come from the LAST `mirror_draft` in session (`session.extracted.
mirror_draft?.quoted_phrases ?? []` — if the user edited the text, some quotes may no longer be
present verbatim, that's fine, the receipt is informational only, not re-verified here).
Store `extracted.mirror = {paragraphs, quoted_phrases}`. Receipt:
`MODULE_REGISTRY.mirror.receipt({mirror: {quoted_phrases}})`. `markModuleComplete` → build
`modules`. `applyToDoc`: `setThesisIntroFromMirror(doc["thesis.md"], paragraphs)` (task 3) when
`getProfileDoc` returns non-null (it always should at this point, but guard defensively the same
as every other route) + `upsertProfileDoc`. `saveSession` with `status: "complete"` (per
V3A_DESIGN.md §2.3 — "marks the module; onboarding completes"; harmless if `status` was already
`"complete"` from `finish_interview` earlier). Return `{ok: true, key: "mirror", receipt}`.

**Tests:** one `*.route.test.ts` per new route file, mocking at the same boundary as
`modules/[key]/route.test.ts` (read it again for the exact mock shape) — PLUS mock
`@/lib/anthropic/moduleTurns`'s relevant function(s) and `@/lib/db/ledger`'s
`recordOnboardingTurn`. Cover: 401/403 gates, the happy path (asserts `markModuleComplete`
called with the right key + a non-null receipt, `saveSession` called with the right `modules`/
`extracted`, ledger recorded exactly once — or exactly twice for mirror's low-quote-retry path),
a fabricated/non-verbatim phrase or claim being DROPPED (construct a mock turn result containing
one real substring and one fabricated string, assert only the real one survives in what gets
written to the doc / returned to the client), metrics' marking-POST rejecting incomplete/
mismatched `marks`, mirror's accept route working from client-submitted (possibly-edited)
paragraphs rather than re-deriving from the draft.

---

## Task 6 — Voice/Metrics/Mirror panels + page wiring

Read `web/components/onboarding/EnergyPanel.tsx` (simplest two-field free-text panel) and
`web/components/onboarding/modulePanelContract.ts` (the frozen `ModulePanelProps` shape:
`{onComplete: () => void; fetchImpl?: typeof fetch}`) before writing any of these three.

**`web/components/onboarding/VoicePanel.tsx`** — two tabs ("Paste something you wrote" /
"Write it fresh"), a single `TextArea` bound to whichever tab is active (reducer field `mode:
"paste" | "fresh"`, `text: string`), guidance copy per V3A_DESIGN.md §2.1 verbatim ("Typos fine.
This is about how you sound." placeholder; "strip anything confidential" reminder on the paste
tab). Submit POSTs `{sample: text.trim()}` to `/api/onboarding/modules/voice`, same
reducer-phase pattern as `EnergyPanel` (`editing`/`submitting`/`error`/`finished`,
`useEffect` → `onComplete()` on `finished`). No minimum-length client gate beyond non-empty
(the design's 200-2000 char guidance is copy, not an enforced constraint — do not hard-block
submission on length, that's not in the spec's payload contract).

**`web/components/onboarding/MetricsPanel.tsx`** — two-phase client component:
1. On mount, `POST /api/onboarding/modules/metrics/extract` (no body) to fetch claims — a
   loading skeleton state while pending (mirror `CalibrationGeneratingSkeleton`'s pattern in
   `CalibrationPanel.tsx` if you want a reference, or a simple "Reading your resume and answers…"
   text — do not over-build this).
2. Once claims arrive, render one row per claim: the claim text as a quote (amber open-quote
   glyph + `text-ink`, per design 2.2), a source `Badge` (`tone="neutral"`, label
   `from your {source==="cv" ? "resume" : source}` — map `cv→resume`, others pass through), and
   a two-state segmented control (`Confident` / `Don't use` — two adjacent buttons, `aria-
   pressed` on whichever is selected, same visual language as `DealbreakersPanel`'s `ChipToggle`
   but as a pair, not a toggle). Nothing pre-selected. A "mark all confident" ghost link sets
   every row to confident in one action (still individually overridable after). Submit is
   disabled until every row has an explicit mark. Framing copy verbatim from the design: "Every
   number we found. Anything you don't mark Confident will never appear in a resume or cover
   letter we write. This is the fence." Submit POSTs
   `{marks: rows.map(r => ({id: r.id, confident: r.mark === "confident"}))}` to
   `/api/onboarding/modules/metrics`. If the extract step returns zero claims, skip straight to
   `onComplete()`-eligible state with a short "Nothing to mark — moving on" message and a
   Continue button that still POSTs `{marks: []}` (server-side: zero claims + zero marks is a
   valid, matching, empty coverage set — task 5's route must accept this; if you find task 5's
   route rejects an empty array as "mismatched", that's a bug in task 5's coverage-validation,
   not this panel — flag it, don't work around it client-side).

**`web/components/onboarding/MirrorPanel.tsx`** — on mount, `POST
/api/onboarding/modules/mirror/generate`. While pending, a loading state. Once paragraphs
arrive: heading `text-3xl tracking-tight` "Here's who we think you are. You get final say.",
the two paragraphs `text-lg leading-relaxed max-w-prose` (sequential fade+translateY entrance is
a nice-to-have — use the existing `panel-enter`/`message-enter` CSS utility classes already in
the codebase per V3A_DESIGN.md's "no new tokens" rule; do not invent new keyframes/utilities —
if a true 500ms-staggered per-paragraph entrance needs a utility that doesn't exist, apply
`message-enter` to each paragraph and accept the existing timing rather than adding CSS). Three
actions: **"That's me — finish my profile"** (primary amber) → `POST
/api/onboarding/modules/mirror/accept` with the current (possibly-edited) paragraphs →
`onComplete()`. **"Edit it"** (ghost) → swaps each paragraph's display into a `TextArea` in
place (local state only, no network call) — accept then submits the edited text. **"Try again"**
(one regen max) → re-`POST /modules/mirror/generate`, replacing the displayed paragraphs with
the new result; disable this button after it's been used once (track locally with a boolean —
the server also caps it, but the button should reflect the cap so a disabled/no-op second click
isn't the only feedback). Highlight the user's own quoted phrases in the paragraph text with a
`color-mix(amber 25%)` underline-tint if that utility/pattern already exists in the codebase
(grep `color-mix` in `globals.css`); if it does not exist as a reusable class, do a simple
`<mark>`-free inline `<span>` wrap with an amber underline via Tailwind arbitrary value
(`className="underline decoration-amber/40"`) rather than adding new CSS — keep it minimal.

**Wiring into `web/app/(app)/onboarding/page.tsx`:**
- Import the three panels.
- In `renderActivePanel`'s `switch (activeModule)`, replace the `case "voice": case "metrics":
  case "mirror":` (currently falling into the shared default with `range`/`evidence`) with three
  separate cases:
  ```tsx
  case "voice":
    return <VoicePanel onComplete={() => onModuleComplete("voice")} />;
  case "metrics":
    return <MetricsPanel onComplete={() => onModuleComplete("metrics")} />;
  case "mirror":
    return <MirrorPanel onComplete={onMirrorComplete} />;
  ```
  (`range`/`evidence` keep falling through to the existing `default: return <DoneForNowView
  .../>` — they have no redo panel and, per `isInterviewBlockActive`, are never actually
  selected as `activeModule` during normal flow; do not add cases for them.)
- Mirror's completion is terminal (last module in `CANONICAL_MODULE_ORDER`) and must route to
  `/profile` per V3A_DESIGN.md §4 build item 4 ("onboarding's done state = route to /profile"),
  NOT fall back to `DoneForNowView`. Add a new handler in the component
  (`OnboardingPage`, near `handleModuleComplete`):
  ```ts
  async function handleMirrorComplete() {
    window.location.assign("/profile");
  }
  ```
  and pass `onMirrorComplete={handleMirrorComplete}` down through `OnboardingViewProps` (add the
  prop, thread it through `renderActivePanel`'s destructured props, matching how
  `onModuleComplete` is already threaded). Use `window.location.assign`, not `next/navigation`'s
  `useRouter` — this file already avoids `next/navigation` (see the `?module=` comment
  explaining why) and a hard navigation is fine/simpler here since onboarding is finished
  anyway. Do NOT call `onModuleComplete("mirror")` for this case (that would refetch state and
  render `DoneForNowView` for a flash before any redirect) — go straight to the redirect.

**Tests:** `VoicePanel.test.tsx` / `MetricsPanel.test.tsx` / `MirrorPanel.test.tsx` — same
direct-render + `fetchImpl` mock style as `EnergyPanel.test.tsx` / `DealbreakersPanel.test.tsx`
(read one for the pattern), covering the happy path calling `onComplete`, an error state not
calling it, and (metrics) submit staying disabled until every row is marked, and (mirror) the
"Try again" button being disabled after one use and edit-in-place working. Extend
`page.test.tsx`: `renderActivePanel` renders the right panel for `activeModule ===
"voice"/"metrics"/"mirror"`, and mirror's `onComplete` triggers a redirect to `/profile` (mock
`window.location.assign` — check how, if at all, existing tests in this suite already stub
`window.location`; if none do, `Object.defineProperty(window, "location", {value: {assign:
vi.fn()}, writable: true})` in a `beforeEach` is the standard vitest/jsdom approach).

---

## Exit criteria (verify after all tasks, before the final review)

- `cd web && npx vitest run` — full suite green.
- `cd web && npx tsc --noEmit` — green.
- `cd web && npm run build` — green.
- `python -m pytest` (repo root) — green, including `tests/test_v3a_onboarding_doc_fixture.py`
  and any other onboarding fixture tests — these should be unaffected by this session's changes
  (no doc-shape changes to the phase-1 fixture), but must still pass.
- Scrub gate: grep the diff for any literal operator-identifying string (name, personal email,
  specific employer) — should find none; all prompts/fixtures use generic placeholders.
- `git diff --stat` against `feat/v3a` shows changes only inside this session's ownership:
  `web/lib/anthropic/interview.ts`, `web/lib/anthropic/moduleTurns.ts` (new),
  `web/lib/onboarding/verbatim.ts` (new), `web/lib/onboarding/handleTurn.ts`,
  `web/lib/onboarding/moduleRegistry.ts`, `web/lib/onboarding/moduleWriters/{voice,metrics,
  mirror}.ts` (new), `web/app/api/onboarding/modules/{voice,metrics,mirror}/**` (new),
  `web/app/api/onboarding/anchor/route.ts` (task 0's checkpoint fix, if needed),
  `web/app/api/onboarding/__tests__/phase1CheckpointIntegration.test.ts` (new),
  `web/components/onboarding/{Voice,Metrics,Mirror}Panel.tsx` (new),
  `web/app/(app)/onboarding/page.tsx`, plus each new/touched file's own `*.test.ts(x)`.

Commit message: `V3A-B2: voice/metrics/mirror LLM modules — verbatim-verified, ledger-true,
mirror reveal`. Push `feat/v3a-b2-llm`. Do NOT merge.
