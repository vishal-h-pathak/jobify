# Session 56 — INT2-B: profile-conditioned reaction deck  (worktree `feat/int2-deck`)

**Model: Sonnet.** Read FIRST: `planning/FEEDBACK_U2_2026-07-21.md` item 2 —
the live evidence: a media strategist was shown an engineer role and an
opaque "Account Director, Manufacturing" card with nothing to judge by. The
deck must be generated FROM the user's anchor + resume, and every card must
carry enough to react to.

## Constitutional rules
1. Scrub gate PASS; Alex Quinn fixtures; no operator strings.
2. The ONE new LLM call (deck generation) is metered: budget_ledger row,
   event `deck_gen`, forced tool_choice (house transport rule — unforced
   calls are banned on this transport), max_tokens ≤2048.
3. No migrations. Deck storage: `session.extracted.reaction_deck`
   (jsonb-shaped object, schema below).
4. Commit on `feat/int2-deck`; no push, no merge.

## Collision avoidance (session 55 runs in parallel)
YOURS: `web/app/api/onboarding/modules/reactions/**`,
`web/lib/anthropic/moduleTurns.ts` (ADD a deck-generation turn — do not
touch the voice/metrics/mirror functions), the reactions UI components,
their tests.
NOT YOURS: `handleTurn.ts`, `interview.ts`, `/api/onboarding/turn`,
`applyToolCalls.ts`, checklist/intent files (55 is creating them), admin.

## The work
1. **Deck generation turn** (`runDeckGenerationTurn` in moduleTurns.ts):
   input = anchor (title/company/free_text) + resume cv_markdown (if
   present, truncated sensibly) + any stated direction. Output via forced
   tool `record_deck`: exactly 8 scenarios, each
   `{id, title, org_flavor, gist, probe}` where `gist` is 1-2 plain
   sentences on what the role actually does day-to-day and `probe` names
   which taste dimension the card tests (scope/pace/autonomy/domain/
   people-vs-craft...). Rules pinned in the prompt: scenarios must span
   AT LEAST 4 distinct probe dimensions; all must be plausible for this
   candidate's field (no engineer cards for a media strategist); no real
   company names — org_flavor is a type ("a 50-person B2B SaaS company"),
   never a brand.
2. **Route integration**: reactions module start → if
   `extracted.reaction_deck` absent, generate once (metered), store, then
   serve. Failure semantics per house rules: generation failure NEVER
   blocks the module — fall back to the existing static deck, log loudly,
   and never persist an empty/partial deck (mirror-incident lesson: an
   empty artifact must not satisfy the exists-check).
3. **Card UI**: render title + org_flavor + gist (the gist is the fix for
   "not enough details to know if I'm interested"). Reactions extraction/
   receipts unchanged.
4. **Regeneration**: one admin-triggerable regen via the existing
   reset-module path (resetting reactions clears reaction_deck too —
   verify, wire if not).

## Verification
tsc / vitest / build / scrub. Tests: generation-turn parse + forced-tool
shape, dimension-spread rule enforced server-side (reject/regenerate once
if <4 dimensions, then fall back), never-persist-empty, static-deck
fallback, reset clears deck. Aim ≤~500 lines.

## Report format
Status/files/tests; the deck-generation prompt verbatim; storage shape
verbatim; fallback semantics as coded; suites; scrub. Do not begin until
the owner confirms.
