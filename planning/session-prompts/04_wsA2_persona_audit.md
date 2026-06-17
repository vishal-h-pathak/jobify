# Session 04 — WS-A2: Persona-data audit (route everything through the loader)  (Wave 2)

**Run from:** `jobify/`.
**Depends on:** WS-A1 (01) — the frozen profile contract.
**Parallel-safe with:** WS-E (06), WS-F (07). **Coordinate with WS-D (05):** both
may touch `submit/adapters/_common.py`. WS-A2 OWNS `_common.py::applicant_fields`
(make it read the loader); WS-D consumes it. Run WS-A2's `_common.py` change
first, or run them sequentially.

---

## Context

After WS-A1 the profile contract is frozen and a neutral example persona exists.
But ~234 places in the Python code still hard-code Vishal's data (prompts that
name "Vishal", a hard-coded `BASE_RESUME`, form-fill fixtures, etc.). This session
drives persona references to ZERO by routing every one through `profile_loader` /
`application_defaults`. Read `jobify/planning/PROJECT_PLAN.md` §5 (WS-A).

## Goal

`grep -ri "vishal|pathak|gtri|thak.io|rain neuromorphic|eon.systems"` over the
package returns nothing, and the pipeline runs on the example persona.

## Tasks (known offenders — verify with a fresh grep)

1. **`tailor/latex_resume.py`** — the hard-coded `BASE_RESUME` must come from
   `profile/cv.md` via the loader, not a literal. (Resume *layout* is WS-F's
   gallery; this is about *content* sourcing.)
2. **Prompt files** that name Vishal or his history: `hunt/prompts/_shared.md`,
   `hunt/prompts/scorer.md`, `tailor/prompts/_shared.md`,
   `tailor/prompts/tailor_resume.md`, `tailor_cover_letter.md`,
   `tailor_latex_resume.md`, `classify_archetype.md`, `form_answers.md`,
   `agent_common.md`. Rewrite so persona content is injected from the loaded
   profile at runtime (these prompts already get `build_profile_prompt_string`
   context — make them reference *the candidate* generically and pull specifics
   from the spliced profile, never hard-coded names/companies).
3. **`submit/adapters/_common.py`** — `applicant_fields` / `FAKE_APPLICANT`:
   source from `load_application_defaults()` + `load_profile()` identity, not a
   literal dict. (You own this file; WS-D reads the result.)
4. **`notify.py`** — `cockpit_url` and any personal URLs from config/env.
5. **`hunt/scripts/check_liveness.py`**, **`hunt/sources/workday.py`**, smoke
   tests (`smoke_greenhouse*.py`), `tests/fixtures/beacon_job.json`, and other
   test fixtures: replace Vishal-specific fixtures with the example persona /
   generic fixtures.
6. **`cv_sync_check.py`** (if kept) — point it at the example persona's `cv.md`
   + article-digest; keep it as an optional drift check.
7. Remove any remaining references to the deleted `interview_prep` /
   pattern-analysis modules.

## Exit criteria

- `grep -rEi "vishal|pathak|gtri|thak\.io|rain neuromorphic|eon\.systems|cape canaveral|papercuts" jobify/` (the package) returns nothing.
- `pytest` is green with `JOBIFY_PROFILE_DIR=profile.example`.
- `JOBIFY_PROFILE_DIR=profile.example jobify-hunt --once --mode local_remote`
  runs and scores against the example `portals.yml` (free sources OK).
- A tailored resume + cover letter generate for one example job using only the
  example persona.
- Commit: `WS-A2: route all persona data through the loader; zero hard-coded identity`.
