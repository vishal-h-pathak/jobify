# Session 01 — WS-A1: Freeze the profile contract + example persona  (Wave 1)

**Run from:** `jobify/` (after Session 00 is committed).
**Depends on:** Session 00.
**Unblocks:** WS-A2 (04), WS-D (05), WS-E (06), WS-F (07) all consume the frozen
contract from this session. Do this before that fan-out.
**Parallel-safe with:** WS-B (02), WS-C (03) — disjoint files.

---

## Context

Read `jobify/planning/PROJECT_PLAN.md` §3 (the persona layer) first. All
user-layer reads funnel through `jobify/jobify/profile_loader.py`. This session
**defines and freezes the profile contract** and ships a neutral example persona,
so downstream sessions have a stable target. It does NOT yet chase down every
hard-coded "Vishal" reference in the code — that's WS-A2 (Session 04).

## Goal

One consolidated, documented profile directory contract + a complete neutral
example persona + a validating loader. After this, "what files make up a user's
profile and what's in each" is settled.

## Tasks

1. **Consolidate the profile files into ONE directory contract.** Today they're
   split: top-level `profile/` (`profile.yml`, `thesis.md`, `voice-profile.md`,
   `article-digest.md`, `learned-insights.md`) and `jobify/hunt/profile/`
   (`cv.md`, `disqualifiers.yml`, `portals.yml`). Move all eight under one
   profile dir that the loader resolves via `JOBIFY_PROFILE_DIR`. Update
   `profile_loader.py` and any caller that reads the hunt-side files directly.

2. **Document the contract.** Add loader functions (or docstrings) covering all
   eight files. Write `onboarding/schema/` stubs (one schema or documented shape
   per file) describing required vs optional fields — WS-E validates against
   these. Keep `profile.yml`'s `application_defaults` block (the PII the submit
   prefill types into forms) clearly specified — list every key the submit
   adapters read.

3. **Create `profile.example/`** — a complete, loadable profile for a NEUTRAL
   invented persona (NOT Vishal; e.g. a generic mid-career software engineer).
   Every one of the eight files present, realistic but clearly fictional, with
   **heavy inline comments** explaining each field so a new user (or the
   onboarding flow) understands what goes where.

4. **Generalize the `archetypes` block.** The current archetypes are
   Vishal-specific lanes (compneuro, neuromorphic, BCI, agentic-builder…).
   Replace with 2–3 GENERIC example archetypes (e.g. "backend/platform eng",
   "ML eng", "developer-facing/SE") and a documented "how to add your own
   archetype" comment. **Drop** the archetype that cites this pipeline itself as
   the user's proof artifact.

5. **Point the loader's default at `profile.example/`** when `JOBIFY_PROFILE_DIR`
   is unset, so a fresh clone loads *something* valid (the example), and a real
   user overrides via the env var / their generated `profile/`.

## Exit criteria

- `JOBIFY_PROFILE_DIR=profile.example python -c "from jobify.profile_loader import load_profile, load_thesis, load_voice_profile; print(load_profile()['identity'])"` works and prints the example identity.
- All eight files load (no missing-file warnings) for `profile.example/`.
- `onboarding/schema/` describes each file's shape.
- No code path reads a persona file by a hard-coded path outside the loader.
- Commit: `WS-A1: consolidate + freeze profile contract, add neutral example persona`.

## Hand-off note (write into the commit body or `onboarding/schema/README.md`)
List the exact filenames + required keys of the frozen contract so Sessions 04,
05, 06, 07 can rely on it without re-deriving it.
