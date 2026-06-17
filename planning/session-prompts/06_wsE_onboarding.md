# Session 06 — WS-E: Build the onboarding flow  (Wave 2; may take 2 sessions)

**Run from:** `jobify/`.
**Depends on:** WS-A1 (01) — the frozen profile contract + `onboarding/schema/`.
**Parallel-safe with:** WS-A2 (04), WS-D (05), WS-F (07) — writes under
`onboarding/` + `docs/ONBOARDING.md`.

---

## Context

The centerpiece. A conversational Claude skill that interviews a new user,
ingests his resume, elicits his voice, and writes a complete, valid `profile/`
directory matching the frozen contract. The friend runs this ONCE after setup.
Read `jobify/planning/PROJECT_PLAN.md` §2, §5 (WS-E), and `onboarding/schema/`.

## Goal

`onboarding/SKILL.md` (+ supporting prompts/schema/examples) that turns "a person
+ their resume" into a loadable `profile/` dir, and a golden example run reused as
the repo's shared test fixture.

## Tasks

1. **`onboarding/SKILL.md`** — the interview, structured in stages. The skill
   should be runnable in Claude Code / Cowork; it reads an uploaded resume and
   asks the user questions, then writes files. Stages:
   1. **Resume ingestion** — accept PDF/DOCX/MD/txt; extract roles, dates,
      skills, education, metrics. (Use the repo's pdf/docx tooling or a simple
      text extraction.)
   2. **Identity & logistics** — name, contact, location, remote/relocation,
      current/target comp, **work authorization + the full `application_defaults`
      set the submit prefill needs** (visa/sponsorship, start date, in-person,
      AI-policy ack).
   3. **Targeting** — what he wants (his tiers), dream companies/industries, hard
      disqualifiers, degree-gate situation.
   4. **Voice elicitation** — gather REAL writing samples (a past cover letter,
      "explain your best project to a friend in a paragraph", a few messages) and
      derive the do/don't `voice-profile.md` from them — not from a template.
      Insist on at least one substantial sample; degrade gracefully if sparse.
   5. **Proof points** — turn resume bullets into claim→evidence pairs; explicitly
      separate confident metrics from a "do not invent" list.
   6. **Archetypes** — derive 1–N framing lanes from his target tiers, following
      the generalized archetype format from WS-A1.
   7. **Resume template pick** — present the WS-F gallery; record the choice in
      the profile.
2. **Generation** — write all eight profile files into a target dir (default
   `./profile/`). **Validate** each against `onboarding/schema/` and confirm it
   loads via `profile_loader`. Report anything missing and re-ask.
3. **Portals seeding** — from stated targets, generate a starter `portals.yml`
   (Greenhouse/Lever/Ashby/Workday sections) and surface the existing
   "how to find + verify an ATS slug" procedure so the user can confirm boards.
4. **Keys** — instruct the user where to put his own keys (`.env`), don't store
   secrets in the profile.
5. **`onboarding/examples/`** — produce ONE complete golden persona via the flow
   (can reuse / refine `profile.example/`). This is the shared test fixture for
   WS-A2/D/F and Phase F. Keep it obviously fictional.
6. **`docs/ONBOARDING.md`** — short user-facing "how to run the interview".

## Exit criteria

- Running the skill on a sample resume produces a `profile/` that loads with no
  missing required fields (validated against `onboarding/schema/`).
- That generated profile drives a green `jobify-hunt --once`, a tailored resume
  + cover letter render, and a successful prefill (smoke).
- `onboarding/examples/` golden persona is committed and referenced by tests.
- Commit: `WS-E: conversational onboarding flow → generates a valid profile`.

## Note
Resume ingestion: prefer the repo's existing pdf/docx skill/tooling if present;
otherwise a straightforward text extraction is fine. The interview quality
matters more than fancy parsing — the model can read an extracted-text resume.
