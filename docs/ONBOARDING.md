# Onboarding — generate your profile from a conversation

jobify is personalized by one thing: your **`profile/` directory** — eight files
the hunt → tailor → submit pipeline reads through `jobify.profile_loader`. You
generate it **once**, by running a conversational interview skill that reads your
resume, asks you questions, elicits your writing voice, and writes the files for
you.

You don't hand-author YAML. You talk to the skill; it produces a valid profile.

## Before you start (~20–30 min)

1. Finish `docs/SETUP.md` (Supabase + your keys). Onboarding writes **no
   secrets** into the profile — keys live in `.env`.
2. Have on hand:
   - **Your resume** — PDF, DOCX, Markdown, or plain text.
   - **A real writing sample or two** — an old cover letter, a substantial
     Slack/email message, a paragraph explaining a project. The interview derives
     your *voice* from real text; it will not fake it from a template.

## Run the interview

Open this repo in an agent that can run skills (Claude Code, or Cowork) and
invoke the onboarding skill at **`onboarding/SKILL.md`**:

> "Run the jobify onboarding skill to build my profile."

The skill walks you through seven stages:

1. **Resume ingestion** — it reads your resume and reflects back your roles,
   dates, skills, education, and metrics for you to correct.
2. **Identity & logistics** — name, contact, location, remote/relocation, comp,
   and the full set of form-fill defaults the auto-submit needs (work
   authorization, sponsorship, start date, in-person preference, AI-policy
   acknowledgement).
3. **Targeting** — your tiers (dream → acceptable), dream companies/industries,
   hard disqualifiers, and any degree-gated roles.
4. **Voice elicitation** — you paste a real writing sample; it derives your
   actual do/don't writing rules from it.
5. **Proof points** — it turns your bullets into claim→evidence pairs and splits
   metrics you're confident about from a "do not invent" list (so the tailor
   never fabricates numbers).
6. **Archetypes** — it derives 1–N framing "lanes" from your tiers that the
   tailor picks between per job.
7. **Resume template pick** — you choose a template from the ATS-safe gallery in
   `jobify/resume_templates/` (`classic`, `modern`, `compact`, `accent`,
   `executive`).

It then **writes all eight files** (default `./profile/`), seeds a starter
`portals.yml` from your targets, and **validates** the result.

## What gets written

| File | What it holds |
|---|---|
| `profile.yml` | identity, logistics, tiers, archetypes, `application_defaults` (the PII the submit pre-fill types into forms), template pick |
| `thesis.md` | your judgment: tiers, hard constraints, energy signals (the scorer reads this first) |
| `voice-profile.md` | how you write — do/don't rules derived from your sample |
| `article-digest.md` | claim→evidence proof points + confident vs do-not-invent metrics |
| `cv.md` | your master CV (source of truth for resume content) |
| `disqualifiers.yml` | hard dealbreakers + soft concerns |
| `portals.yml` | the ATS boards to poll + a title pre-filter |
| `learned-insights.md` | optional, accumulates over time (ships ~empty) |

The full contract lives in `onboarding/schema/` (read `README.md` there). A
complete, valid reference profile is `profile.example/` (a backend engineer); a
second worked example with the interview that produced it is
`onboarding/examples/` (a frontend engineer).

## Verify it worked

The skill runs this for you, but you can re-run it any time:

```bash
python onboarding/validate_profile.py ./profile      # exit 0 = valid
```

- **ERRORs** must be fixed (missing required fields) — the skill re-asks for them.
- **WARNINGs** are quality gaps (e.g. you skipped disqualifiers) — optional but
  recommended.

Then confirm the pipeline reads it and see your first roles (needs your keys):

```bash
JOBIFY_PROFILE_DIR=./profile python -c \
  "from jobify.profile_loader import load_profile; print(load_profile()['identity']['name'])"

jobify-hunt --once     # discover + score roles against your profile
```

## Verifying ATS slugs

The seeded `portals.yml` contains example company boards — **verify each slug
before relying on it** (a wrong slug just yields nothing, but clean it up). The
find-and-verify procedure (with `curl` checks for Greenhouse/Lever/Ashby/Workday)
is in `onboarding/references/portals-seeding.md`; the skill walks you through it.

## Editing or regenerating later

Your profile is yours. **Code never overwrites it.** Hand-edit any file (they're
heavily commented), or re-run the onboarding skill to regenerate from scratch.
After editing, re-run the validator to make sure it still loads.
