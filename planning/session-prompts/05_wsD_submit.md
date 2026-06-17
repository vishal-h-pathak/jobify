# Session 05 — WS-D: Generalize the auto-prefill submit  (Wave 2)

**Run from:** `jobify/`.
**Depends on:** WS-A1 (01) profile contract; ideally after WS-A2 (04) has made
`submit/adapters/_common.py::applicant_fields` read the loader. If running
alongside WS-A2, do NOT both edit `_common.py` — let WS-A2 own it.
**Parallel-safe with:** WS-E (06), WS-F (07).

---

## Context

This is the feature that must be preserved exactly: one click opens the live
application in a visible browser with every field pre-filled from the user's
profile/PII, parked **before** the site's Submit button. Today this is the
`jobify-submit` local-Playwright path with per-ATS DOM fillers (Greenhouse,
Lever, Ashby) + a generic fallback. Read `jobify/planning/PROJECT_PLAN.md` §2,
§5 (WS-D).

## Goal

The local visible-browser prefill works end-to-end driven entirely by the loaded
profile — no hard-coded applicant data — and never clicks the final submit.

## Tasks

1. **Audit every value the fillers type** and confirm it originates from the
   profile via the loader: identity (name/email/phone), location, work
   authorization, visa/sponsorship, start date, relocation/in-person answers,
   AI-policy ack, comp, and the narrative form-answer drafts. Source from
   `load_application_defaults()` + `load_profile()` (and the tailor's generated
   `form_answers`). Remove any residual hard-coded fixtures.
2. **Per-ATS DOM fillers** (`submit/adapters/prepare_dom/{greenhouse,lever,
   ashby}.py`) and the generic fallback: verify field-mapping logic is
   persona-agnostic and reads generalized fields. Fix anything that assumed
   Vishal-shaped data.
3. **Stop-at-submit invariant:** confirm `confirm.py` / the prepare-only flow
   NEVER clicks the final submit; it prepares + screenshots + parks for the human.
   Add/keep a test asserting the submit button is not clicked.
4. **Keep it local-first.** The default path is local visible Chromium
   (`playwright install chromium`). Browserbase remains optional/legacy behind an
   env flag; don't make it required.
5. **Dashboard handoff:** ensure the "Pre-fill Form" action → `prefilling` status
   → this runner picking up the row → opening the browser still works against the
   generalized data. (Dashboard wiring itself is WS-B; here just confirm the
   pipeline side of the contract.)

## Exit criteria

- With `JOBIFY_PROFILE_DIR=profile.example`, running the submit prefill against a
  real Greenhouse (or Lever/Ashby) test posting opens the form with
  identity/contact/location/comp/answers filled and stops before submit.
- A test asserts the final submit button is never clicked.
- `grep` finds no hard-coded applicant data in `submit/`.
- Commit: `WS-D: generalize auto-prefill submit; profile-driven, stop-at-submit`.

## Note
Use a known stable public ATS posting for the manual smoke (any open Greenhouse
board job's apply page). Don't submit anything — park before the button.
