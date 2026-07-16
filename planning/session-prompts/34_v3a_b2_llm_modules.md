# Session 34 — V3A-B2: The three LLM modules — voice, metrics, mirror  (V3a wave 3, single session)

**Model: Sonnet.** Spec = `planning/V3A_DESIGN.md` §2 — read FIRST; the prompt
rules and verbatim-verification requirements there are the heart of this
session. Also PRODUCT_VISION.md §2 items 10–12.
**Branch discipline:** worktree `jobify-wt/v3a-b2-llm`, branch
`feat/v3a-b2-llm` **off `feat/v3a`** — only AFTER 32 (B1) has merged (the
launcher enforces it). Push; reviewer merges.
**You own:** `web/lib/anthropic/interview.ts` (voice/metrics/mirror prompts +
tools), `web/lib/onboarding/handleTurn.ts` (the wave-3 glue ONLY: mark
`range`/`evidence`/`targeting` module keys complete on their existing tool
calls), `web/lib/onboarding/moduleRegistry.ts` (receipt internals for the
three new + three glued modules — the design's flagged "smallest sanctioned
touch"; the pinned contract SHAPE is still frozen),
`web/app/api/onboarding/modules/{voice,metrics,mirror}/**` (new),
`web/components/onboarding/{Voice,Metrics,Mirror}Panel.tsx` (new) + their
wiring into `web/app/(app)/onboarding/page.tsx`, tests, fixture regen if
extraction shapes changed. Do NOT touch `web/app/(app)/profile/**`,
`web/lib/dossier/**`, feed/settings/admin, `jobify/`, migrations.

## Owner decisions binding this session (2026-07-06)
- **Metrics sweep EVERYTHING:** the extraction turn reads cv/resume content
  AND every chat answer in the session transcript — any number or checkable
  claim, max 12 items, each verified as a VERBATIM SUBSTRING of its source
  (per the design) or it is dropped. Nothing pre-selected; the user marks
  each `confident` / `don't use` in a zero-LLM marking POST.
- **No automatic hunt at mirror-accept.** The mirror's accept action writes
  the doc and routes to `/profile` (the dossier renders the new narrative —
  that's the payoff); any hunting stays on the feed's manual button.

## Task 0 — MANDATORY debt from wave 2 (do this first)
Write the cross-route phase-1 integration regression test B1 was asked for
and didn't ship: drive ALL FOUR phase-1 modules (anchor, reactions, values,
dealbreakers) through their REAL route handlers with fakes for DB/dispatch,
in at least two completion orders (anchor-first and anchor-last), asserting
the checkpoint hunt fires EXACTLY ONCE per session and never before all four
are complete. This class of gap (a route not marking its module) survived
two reviews because only per-route unit tests existed.

## Build (per V3A_DESIGN §2 — condensed to obligations)
1. **Dedicated module routes** (NOT /turn — this is what makes the FIX-1
   always-ask exemption structural): each authed+invite-or-admin gated, each
   LLM call through the existing chokepoint with a ledger row; budget target
   for all three ≤ ~$0.50 total.
   - `voice`: one ingest turn; `record_voice` tool; signature phrases
     server-verified verbatim against the user's sample; writes
     voice-profile.md via `applyModuleToDoc`.
   - `metrics`: one extraction turn (scope above) → claims list; separate
     zero-LLM marking POST → article-digest.md confident vs do-not-invent
     sections.
   - `mirror`: one synthesis turn; `record_mirror` requires ≥2 verbatim user
     quotes (server-verified), BAN on trait labels/diagnoses (the design's
     rule list goes in the system prompt verbatim); accept-with-edits POST
     writes the thesis intro. Reject/regenerate allowed ONCE (second turn,
     second ledger row).
2. **Panels:** VoicePanel (sample paste OR "answer like you'd text a
   friend" alternative), MetricsPanel (the marking UI — every claim a row
   with confident/don't-use toggle, source snippet shown), MirrorPanel (the
   staged reveal per the design — the ONE surface allowed to end without a
   question — plus inline edit before accept). Wire into page.tsx's module
   flow (B1's panel-swap pattern) and the PhaseRail.
3. **Glue:** handleTurn marks `range`/`evidence`/`targeting` modules
   complete on record_calibration/record_resume(or skip)/record_targeting;
   targeting's system prompt trimmed per the design (dealbreakers module
   owns filters now — targeting stops asking them).
4. **Completion:** when `mirror` completes, session status → complete;
   onboarding's done state = route to `/profile`.

## Tests
Per-route gate matrix + one-ledger-row-per-LLM-turn (mirror regenerate = 2);
verbatim verification: fabricated phrase/quote/claim is DROPPED (fixture
transcripts); metrics scope includes chat text; marking POST is zero-LLM;
mirror trait-label ban present in prompt; glue marks the three module keys;
page flow reaches /profile on completion; Python fixture cross-check green.

## Exit criteria
Full web vitest + tsc + build green; Python suite + fixture green; scrub
gate PASS; diff inside ownership.
Commit: `V3A-B2: voice/metrics/mirror LLM modules — verbatim-verified, ledger-true, mirror reveal`.
Push; do NOT merge.
