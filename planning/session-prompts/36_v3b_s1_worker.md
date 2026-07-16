# Session 36 — V3B-S1: Tailor worker — verifier, workflow, 0012  (V3b wave 1, parallel with 37)

**Model: Sonnet.** Spec = `planning/V3B_DESIGN.md` — read it FIRST and treat
it as authoritative; this prompt only pins ownership + owner decisions. The
design's reuse map cites exact files/lines of the existing single-user
tailor — reuse them as directed, never rewrite.
**Branch:** `feat/v3b-s1-worker` off main, worktree `jobify-wt/v3b-s1-worker`.
**You own:** `jobify/hosted/**` (tailor worker composition), `jobify/tailor/claims.py`
(new verifier) + minimal additive touches the design names in `jobify/tailor/`
(the `sources` field on the resume JSON contract; CL attribution call),
`jobify/db.py` (tailor_runs helpers), `jobify/migrations/0012_v3b_tailor.sql`
(EXACTLY the SQL in V3B_DESIGN.md — byte-authoritative shared contract with
session 37), `.github/workflows/hosted-tailor.yml`, tests, docs. Do NOT touch
`web/**`, `jobify/submit/**`, `jobify/shared/status.py`, migrations 0001–0011,
or the tailor prompts the design marks reused-unchanged.

## Owner decisions binding this session (2026-07-06)
- **Identity header: render what exists** in profile.yml identity — name
  always; email/phone/linkedin only when present. Never invent, never
  placeholder.
- **Voice-sentence exemption:** CL units the attribution step marks as
  zero-factual-claim connective prose are exempt from sourcing — but they
  MUST still pass the verifier's new-entity check (no company names, roles,
  numbers, technologies smuggled in). Exempt units are tagged `voice` in
  claims.json so the UI can show them as style, not evidence.
- **Budget: shared pool, no sub-cap.** The design's 5-tailors/user/day count
  limit + existing per-user/global rails apply; ledger events per LLM call
  (`tailor_resume`, `tailor_cl`, `tailor_attribution`); BYO bypass as usual.

## Build (per V3B_DESIGN — condensed)
1. **0012** exactly per the design (tailor_runs + unique-partial-index
   cooldown). 2. **Worker** (`jobify-hosted-tailor --run <id>` or per design):
   materialize profile via `JOBIFY_PROFILE_DIR` (one run = one user),
   generate resume+CL via the reused functions, attribution call, verifier,
   render only verified/voice/user-edited units, LaTeX→PDF, upload to
   `job-materials/{user}/{posting}/` (private), write claims.json + honesty
   report alongside, update tailor_runs status (generating→done/failed with
   error). `mode=render` = zero-LLM re-render (template switch / post-edit).
3. **`claims.py` verifier — deterministic Python, no LLM:** numbers must
   exact-match a `## Confirmed metrics` entry or the cited span verbatim;
   prose claims need a real, verbatim-quote-anchored source span + the
   new-entity check; structural facts exact-match. Dropped units → honesty
   report, logged, never rendered.
4. **Workflow** `hosted-tailor.yml`: dispatch inputs per design, TeX
   apt-cached, same secret set as hosted-hunt (document: no new secrets).

## Tests
Verifier matrix (confident-number pass/unconfirmed-number DROP; anchored
prose pass/unanchored DROP; new-entity smuggling DROP incl. in voice units);
identity render-what-exists (all-fields / name-only fixtures); ledger events
per call; tailor_runs lifecycle incl. failure writes error; mode=render is
zero-LLM (assert no ledger rows); cooldown index behavior documented in a
migration-header note. Full suites green.

## Exit criteria
Python + web suites, tsc (untouched web must still pass), build, scrub PASS;
diff inside ownership. Commit:
`V3B-S1: tailor worker — deterministic claims verifier, hosted-tailor workflow, 0012`.
Push; do NOT merge.
