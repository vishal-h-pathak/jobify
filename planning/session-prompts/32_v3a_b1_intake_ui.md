# Session 32 — V3A-B1: Intake orchestration UI  (V3a wave 2, parallel with 33)

**Model: Sonnet.** Spec = `planning/V3A_DESIGN.md` §1 (orchestration) — read it
FIRST, then `PRODUCT_VISION.md` §2 for intent. Implement the design exactly.
**Branch discipline:** worktree `jobify-wt/v3a-b1-intake`, branch
`feat/v3a-b1-intake` **off `feat/v3a`**. Push; reviewer merges into feat/v3a.
**You own:** `web/app/(app)/onboarding/**`, `web/components/onboarding/**`
(new panels; reuse AnchorForm/CalibrationPanel as the design directs),
`web/app/api/onboarding/state/route.ts` (extension), `web/lib/hunt/dispatchHunt.ts`
(ONE sanctioned amendment, below), tests. Do NOT touch
`web/lib/onboarding/**` (wave-1 contracts, frozen), `web/lib/anthropic/**`,
`web/app/(app)/profile/**` + `(app)/layout.tsx` (session 33's),
`jobify/`, migrations.

## Owner decision binding this session (2026-07-06)
Hunts run ONLY on user input. The checkpoint hunt (mid-intake, automatic) is
the sole exception and it must NOT consume the user's cooldown:
**amend `dispatchHunt`: `systemInitiated` now skips the cooldown check AND
skips stamping `last_hunt_requested_at`** (wave-1 stamped it — that would
have cooldown-blocked the user's own first button press minutes later).
Update the wave-1 test accordingly; document the rationale inline. This is
your only allowed touch outside the UI.

## Build (per V3A_DESIGN §1 — condensed to obligations)
1. **PhaseRail** replaces StepSpine: 3 segments (Ground truth / Depth /
   Mirror) with n/m fractions, one continuous amber underline width =
   completed/12, ticking per module completion; receipts come from the
   server (`modules[key].receipt`), not client state.
2. **Extended `GET /api/onboarding/state`:** also return `modules`,
   `next_module` (canonical order per the design), `checkpoint_fired`, and
   the user's current match count (authed client). This powers resumability:
   returning users land on `next_module` with the rail pre-filled.
3. **Module panels:** reactions card-deck (swipe interested/not, post-choice
   one-word-why chips, undo-via-upsert, thin-pool honesty per design);
   values one-pair-per-screen ("Same pay either way" framing, one skip
   allowed); energy (two textareas), environment (4 scenario pairs),
   trajectory (enum + optional text), dealbreakers (list builder) — all
   posting to the wave-1 module endpoints, all using ui/ primitives +
   ONB-C motion utilities.
4. **Checkpoint interstitial:** full-panel beat when phase 1 completes —
   branches HONESTLY on `checkpoint_fired` (fired → "your first hunt just
   left" + match-count chip when >0; not fired → no hunt claim, per design).
5. **Interview block:** the v2 conversational stages (range → resume →
   targeting) slot in as one panel exactly as the design describes — do not
   rebuild them; wire them into the module flow visually (rail ticks when
   their module keys complete — the keys are marked by wave-3's glue; until
   then derive rail state for those three from the existing stage field, as
   the design's transition note specifies).
6. **Done-for-now screen** (pre-mirror, since B2 ships the mirror later):
   after targeting completes, land on the feed CTA + "Run my hunt" button
   (manual, per owner decision). Design §1's ambient re-rank chip.

## Tests
Panel-per-module render + submit wiring (fake fetch); PhaseRail fraction/
receipt derivation matrix incl. resumability from server state; checkpoint
interstitial branches on checkpoint_fired; reactions deck (swipe, why-chip,
undo, completion at 6); dispatchHunt systemInitiated no-stamp regression;
draft-preservation + reduced-motion conventions carried.

## Exit criteria
Full web vitest + tsc + build green; scrub gate PASS; diff inside ownership.
Commit: `V3A-B1: PhaseRail intake orchestration — module panels, reaction deck, honest checkpoint interstitial`.
Push; do NOT merge.
