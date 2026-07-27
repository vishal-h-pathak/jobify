# Session 59 — FEEDQ-1: verdict integrity + rubric determinism + comms catalog  (worktree `feat/feedq-1`)

**Model: Sonnet.** Driven by the second user's (U2's) first real hunt — her
feedback exposed four scoring-layer defects her (correct) profile fed into.
Read FIRST: `planning/FEEDBACK_U2_2026-07-21.md` (background),
`jobify/hosted/fanout.py` (stage 4), `jobify/hunt/rubric.py` +
`jobify/hunt/prompts/rubric_compiler.md` (compile path),
`web/lib/portals/tierPacks.ts`. Live evidence pinned below — design to it.

## The live evidence (from U2's real hunt, verified in prod data)
- Her profile.yml: `target_comp_usd: 110000-200000`, `remote_acceptable:
  true`, base "Atlanta, GA", relocation "Would relocate to New York for the
  right comp", in_person "Hybrid in Atlanta acceptable; hybrid in New York
  acceptable only near $200,000". ALL CORRECT.
- Every stage-4 verdict on her feed treated $110k as a comp CEILING ("hard
  constraint of <$110k", "exceeds your $110k compensation ceiling") — the
  verdict prompt renders comp in a way the model reads as a maximum.
- Her compiled rubric's gates: `remote_acceptable: false`,
  `base_location_substring: ""` — contradicting her profile. The LLM
  compiler mis-derived both (likely from the nuanced in_person text).
- Her feed: 15 surfaced "matches" scored 25-38%, most with verdict text
  ARGUING AGAINST the job ("don't match the candidate's demonstrated
  profile") — surfaced anyway because stage 4 promotes top-N
  unconditionally.
- All 15 from AI/tech companies — the board catalog has effectively zero
  comms/marketing/brand-side employers, and the tag vocabulary has no way
  to express them.

## Constitutional rules
Scrub gate PASS (Alex Quinn fixtures — model U2's SHAPES, never her data);
no migrations; no new LLM calls beyond existing metered paths; commit on
`feat/feedq-1`, no push/merge.

## The work

### 1. Verdict comp rendering — direction-explicit (fanout.py stage 4)
Find where the user's comp/constraints enter the stage-4 verdict prompt.
Replace with a deterministic rendering that makes direction impossible to
misread, e.g.:
`Compensation: the candidate requires AT LEAST $110,000 (floor). Target
range $110,000–$200,000. A posting paying MORE than the target is a
positive, never a concern. Only flag compensation when a posting clearly
pays BELOW the floor.`
Parse `target_comp_usd` (range "A-B" or single value) deterministically —
reuse/align with the S3 comp-filter parser if one exists. Test: prompt text
for a "110000-200000" fixture contains the floor/at-least framing and never
the "<" framing; single-value and unparseable cases covered.

### 2. Verdict quality floor (fanout.py stage 4 + web feed copy)
Stage 4 must be able to surface FEWER than top-N. Add an explicit fit
decision to the verdict tool schema (e.g. `worth_showing: boolean` +
existing reason) — a posting surfaces ONLY on a positive decision; a
negative verdict keeps `status='rejected_llm'` with the reason stored
(funnel-visible, never user-visible as a "match"). Rails: unchanged call
caps; if ALL verdicts are negative, the user simply gets fewer/zero new
matches. Web: the feed's empty/thin state says so honestly ("This cycle
found N postings worth showing you — the rest didn't clear your bar") —
small copy change only, reuse existing empty-state componentry.
Tests: negative verdict → rejected_llm row + not in feed query; positive →
surfaced; zero-positive cycle → feed shows honest copy.

### 3. Rubric compiler determinism (rubric compile path)
`gates.location.remote_acceptable`, `gates.location.base_location_substring`,
and `gates.comp_floor_usd` must be COPIED IN CODE from profile.yml
(`location_and_compensation.remote_acceptable`; base city token, e.g.
"Atlanta" from "Atlanta, GA"; floor = min of target_comp_usd) — never
LLM-derived. The LLM compiler keeps everything genuinely judgment-shaped
(tier_hints, term_groups, weights); after compile, the deterministic gate
values OVERWRITE whatever the model emitted, with a loud log line when they
differ (that's the drift telemetry). Test with a fixture reproducing U2's
exact field shapes (remote_acceptable true + nuanced in_person text +
range comp) asserting the gates come out true/"Atlanta"/110000.

### 4. Comms/marketing catalog pack (+ tag vocabulary)
- Extend the tag vocabulary with `marketing-comms` and `consumer-brand`
  (update the vocabulary constant everywhere it's pinned: tierPacks.ts,
  candidates auto-tagging, seed YAML header comment).
- `deriveTagsFromKeywords`: comms/content/editorial/brand/PR/communications
  keywords → `marketing-comms` (so a comms user's tiers actually select the
  pack).
- Curate ~30 boards where in-house comms/content/brand roles actually live
  — consumer brands, media/entertainment, health/retail/hospitality
  companies on Greenhouse/Ashby/Lever — EVERY ONE live-verified (fetch the
  public endpoint, confirm 200 + name match; the S3 discipline). Append to
  `jobify/data/board_catalog_seed.yml` tagged `marketing-comms` /
  `consumer-brand` (+ any true second tag). The cockpit re-runs the import
  after merge.

### 5. Report the ops runbook (do not execute it)
Your report ends with the exact post-deploy sequence for the cockpit: re-run
catalog import → reset U2's reactions module (admin) → null her
compiled_rubric (forces clean recompile with deterministic gates) → reseed
her portals (picks up marketing-comms pack) → she re-runs the hunt.

## Verification
`.venv/bin/pytest`; `cd web && npx tsc --noEmit && npx vitest run && npm run
build`; scrub. Aim ≤~700 lines excluding seed YAML. Report per-item
status/files/tests, the new verdict-prompt comp block verbatim, the gate
drift-log line, catalog additions table (board/ATS/verified), the runbook.
Do not begin until the owner confirms.
