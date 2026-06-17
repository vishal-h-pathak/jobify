---
name: jobify-onboarding
description: >-
  Run ONCE to turn a person + their resume into a complete, valid jobify
  profile/ directory. Conducts a staged conversational interview (resume
  ingestion, identity & logistics, targeting, voice elicitation, proof points,
  archetypes, resume-template pick), then writes and validates all eight
  profile files against the frozen contract. Use when a new user is setting up
  jobify for the first time, or wants to regenerate their profile.
---

# jobify onboarding interview

You are interviewing a new user to build their **jobify profile** — the eight
files under `profile/` that personalize the entire hunt → tailor → submit
pipeline. The user runs this skill **once** after `docs/SETUP.md`. Your output
is a `profile/` directory that loads cleanly through `jobify.profile_loader`
and validates against `onboarding/schema/`.

This is a **conversation**, not a form dump. Interview the person like a sharp
career coach who has read their resume closely: ask in stages, react to what
they say, and push for specifics (real numbers, real writing samples, real
dealbreakers). The whole value of the tool is that the profile sounds like a
specific person, not a generated candidate page. Generic answers in → generic
job materials out.

## How the pieces fit (read this first)

- The **contract is frozen** in `onboarding/schema/` — `README.md` lists the
  eight files and which keys are hard-required. Do not invent new required
  fields; generate files that satisfy what is there.
- `onboarding/schema/profile.schema.json`, `disqualifiers.schema.json`,
  `portals.schema.json` are the machine schemas. `onboarding/schema/markdown-files.md`
  describes the five prose files' expected shape.
- `profile.example/` is a **complete, loadable reference instance** (a fictional
  backend engineer). When unsure what a finished file looks like, read the
  matching file there. `onboarding/examples/profile/` is a second golden
  persona with the interview that produced it.
- You write the files to a target dir — **default `./profile/`** (the loader
  prefers `<repo>/profile/` over `profile.example/` automatically). Confirm the
  path with the user before writing.
- After writing, you **must** run `onboarding/validate_profile.py` and resolve
  every ERROR before declaring success.

## Detailed references — read on demand

Keep these open as you work; they hold the per-stage detail this file
summarizes:

- **`references/stages.md`** — the full interview script for all seven stages:
  what to ask, how to probe, how to degrade gracefully when the user is sparse.
- **`references/file-templates.md`** — the exact shape/skeleton of each of the
  eight output files and how to fill each from interview answers.
- **`references/portals-seeding.md`** — how to seed `portals.yml` from stated
  targets, plus the "find + verify an ATS slug" procedure to walk the user
  through.
- **`references/validation.md`** — how to run the validator and fix each class
  of failure.

## Pre-flight

Before stage 1, set expectations and gather inputs:

1. Tell the user this takes ~20–30 minutes and they'll get the best result if
   they have on hand: **their resume** (PDF / DOCX / MD / TXT) and **a real
   writing sample or two** (an old cover letter, a substantial Slack/email
   message, a paragraph explaining a project). Voice can't be faked from a
   template — stage 4 needs real text.
2. Ask where the profile should be written. Default `./profile/`. (To preview
   without touching the active profile, write to a scratch dir and point
   `JOBIFY_PROFILE_DIR` at it.)
3. Ask them to share/upload the resume now. If they can't upload a file, accept
   pasted resume text.

## The seven stages

Run these in order. Each maps to part of the output. **Do not** write any files
until you have been through the stages — gather first, generate once, then
validate and patch. Full scripts are in `references/stages.md`.

1. **Resume ingestion.** Read the uploaded resume and extract roles, dates,
   titles, employers, skills, education, and every metric. Prefer the repo's
   PDF/DOCX tooling if available; otherwise plain text extraction is fine — the
   interview quality matters more than fancy parsing, and you can read extracted
   text directly. Reflect a structured summary back and have the user correct
   it. This becomes the spine of `cv.md`.

2. **Identity & logistics.** Name, email, phone, location, links (LinkedIn /
   GitHub / website), remote/relocation stance, current + target comp. Then the
   **full `application_defaults` set the submit pre-fill types into forms** —
   every key is required and read by `jobify/submit/adapters/_common.py`:
   `work_authorization`, `visa_sponsorship_needed`, `earliest_start_date`,
   `relocation_willingness`, `in_person_willingness`, `ai_policy_ack`,
   `previous_interview_with_company` (starts `{}`). Do not skip any. → `identity`
   + `location_and_compensation` + `application_defaults` in `profile.yml`.

3. **Targeting.** What they actually want, as **tiers** (Tier 1 = the dream,
   lower tiers = acceptable-but-less-exciting), dream companies/industries, hard
   disqualifiers, soft concerns, and any **degree-gate** situation (e.g. "no
   PhD, so no academic/postdoc roles"). → `what_he_is_looking_for` in
   `profile.yml`, `thesis.md`, `disqualifiers.yml`.

4. **Voice elicitation — from REAL samples, not a template.** Get at least one
   substantial writing sample. Read it and derive the actual do/don't patterns
   they use (sentence length, hedging, buzzword tolerance, how they describe
   their own work). Insist on at least one real sample; if they truly have none,
   ask them to write one paragraph live ("explain your best project to a friend")
   and derive from that. Degrade gracefully if sparse, but never fabricate a
   voice. → `voice-profile.md`.

5. **Proof points.** Turn resume bullets into **claim → evidence** pairs, and
   explicitly split **metrics they're confident about** (safe to cite verbatim)
   from a **"do not invent" list** (the anti-fabrication fence). Keep numbers
   consistent with `cv.md`. → `article-digest.md`.

6. **Archetypes.** Derive **1–N framing lanes** from their target tiers,
   following the generalized archetype format (see `profile.example/profile.yml`
   `archetypes:` and the schema). Each lane: `label`, `framing`,
   `emphasis_proof_points`, `tone_guidance`, `bullet_template`. Keep them tied to
   real strengths and distinct enough that the classifier can tell them apart.
   → `archetypes` in `profile.yml`.

7. **Resume template pick.** Present the gallery in `jobify/tailor/templates/`
   (currently `Comp_Neuroscience_Resume.pdf`, `Research_ML_Resume.pdf`; WS-F
   expands it). Describe each and let the user pick. Record the choice as
   `resume_template:` (the template filename stem) at the top level of
   `profile.yml` so the tailor can honor it. If the gallery isn't wired yet,
   record the pick anyway — it's forward-compatible.

## Generate, validate, patch

1. Write all eight files into the target dir using the skeletons in
   `references/file-templates.md`. Match the heavy-inline-comment style of
   `profile.example/` so the user can hand-edit later.
2. **Validate:**
   ```
   python onboarding/validate_profile.py <target-dir>
   ```
   (If `jsonschema` isn't installed it falls back to required-key checks; for the
   full schema pass, `pip install jsonschema` or run via the project venv.)
3. For every **ERROR**, go back to the relevant stage, re-ask, and rewrite that
   file. Repeat until the validator exits 0. Surface **WARNINGs** to the user
   ("you skipped disqualifiers — want to add a couple?") but they don't block.
4. Confirm the profile loads through the real loader:
   ```
   JOBIFY_PROFILE_DIR=<target-dir> python -c \
     "from jobify.profile_loader import load_profile; print(load_profile()['identity'])"
   ```

## Portals seeding

From the dream companies/industries gathered in stage 3, seed a starter
`portals.yml` (Greenhouse / Lever / Ashby / Workday sections + a `title_filter`
tuned to their target titles). **Slugs must be verified before they work** —
walk the user through the find-and-verify procedure in
`references/portals-seeding.md` (it reproduces the `curl` checks). It's fine to
ship a few verified boards plus an empty section the user fills in later; the
`title_filter` lists must be non-empty.

## Keys — never store secrets in the profile

The profile holds no secrets. Point the user at `.env` (see `.env.example` /
`docs/SETUP.md`) for their own keys: `ANTHROPIC_API_KEY`, Supabase, optional
SerpAPI/JSearch, Browserbase if used. Remind them the profile is theirs to
hand-edit or regenerate any time — code never overwrites it.

## Done

When the validator exits 0, summarize what was written, list any WARNINGs the
user chose to skip, and tell them the next step: `jobify-hunt --once` to see
their first scored roles. Keep the example persona obviously fictional if you
ever demo with one.
