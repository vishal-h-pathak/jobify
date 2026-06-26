> Cross-project context: ~/dev/jarvis/memory/INDEX.md — read it before asking the user to re-explain. This repo's capsule: ~/dev/jarvis/memory/projects/jobify.md

# jobify — Agent Guide

> **The candidate persona is NOT in this file.** All persona data — identity,
> targeting tiers, disqualifiers, CV, voice — lives in the user-layer profile
> directory and is read through one loader: `jobify.profile_loader`.
> Nothing in the Python package, the prompts, or this file hard-codes a
> specific person. Point the pipeline at any profile and it runs for that
> persona.

## Where the persona lives

The profile directory is resolved by `jobify.profile_loader.profile_dir()`:

1. `JOBIFY_PROFILE_DIR` env var, if set (a generated profile or a test
   fixture).
2. `<repo_root>/profile/` if it exists — the active user's profile, written
   by onboarding. **Git-ignored**, never committed (it holds real PII).
3. `<repo_root>/profile.example/` — the shipped neutral example persona
   ("Alex Quinn"), so a fresh clone runs out of the box.

The eight user-layer files (`profile.yml`, `thesis.md`, `voice-profile.md`,
`article-digest.md`, `learned-insights.md`, `cv.md`, `disqualifiers.yml`,
`portals.yml`) are documented in `onboarding/schema/`. To onboard a real
user, generate `profile/` from those schemas; everything downstream reads it
through the loader.

- **Identity, targeting tiers, comp, archetypes, application-form defaults** →
  `profile.yml` (`jobify.profile_loader.load_profile` /
  `load_application_defaults` / `load_archetypes`).
- **Hunting judgment (tiers, hard constraints, energy signals)** → `thesis.md`
  (spliced FIRST into every scoring/tailoring prompt; wins on conflict).
- **Resume content** → `cv.md` (the tailor selects + reorders from it; never
  invents beyond it).
- **Voice** → `voice-profile.md`.

The tailor and hunt prompts already receive the merged profile as LLM context
(`prompts.cached_system_blocks` / `hunt.prompts.build_profile_prompt_string`),
so prompts reference "the candidate" generically and let the injected profile
supply the specifics.

---

# jobify — unified hunt → tailor → submit pipeline

Three console scripts live in `pyproject.toml::[project.scripts]`:

| Script | Entry point | Role |
|---|---|---|
| `jobify-hunt`   | `jobify.hunt.agent:run`                         | discover roles, score, upsert |
| `jobify-tailor` | `jobify.tailor.pipeline:run_tailor_only`        | tailor resume / cover letter / form answers (no browser) |
| `jobify-submit` | `jobify.tailor.pipeline:run_submit_only`        | visible-browser pre-fill for rows the cockpit enqueued |

PR-13 split the tailor's combined cycle into two narrower entry points
so an automated trigger (CI, cron) can hit `jobify-tailor` without
opening a visible browser. The retired Browserbase + Stagehand runner
lives at `jobify/submit/runner_legacy.py` and has no console-script
binding; PR-13 reused the `jobify-submit` script name on purpose for
the local-Playwright pre-fill phase.

## Cross-cutting modules (canonical, no per-subtree shims after PR-9)

- `jobify.config` — every env-driven knob and helper. Soft defaults
  (empty string for secrets) so the module imports without credentials.
  `jobify.submit.config` re-promotes the submit-required secrets via
  `require_env` (fail-loud at import).
- `jobify.db` — Supabase data layer. Lazy module-level singleton; the
  `client` / `service_client` attributes resolve via module
  `__getattr__` so the import is side-effect-free.
- `jobify.notify` — Resend digest (hunt) + Supabase notifications table
  (tailor / submit). Canonical `send_*` names only — the deprecated
  `notify_*` aliases were removed once grep showed no callers.
- `jobify.shared.*` — `jobid`, `validator`, `html`, `storage`,
  `ats_detect`. Pure helpers used by ≥2 subtrees.

## Hunt subtree (`jobify/hunt/`)

Discovery + scoring + upsert. Two modes:

- `local_remote` (default): Atlanta + remote roles only.
- `us_wide`: also pulls non-remote US roles.

Sources are pure HTTP/JSON or RSS — no LLM tokens spent on discovery.
Each posting is title-pre-filtered against
`jobify/hunt/profile/portals.yml::title_filter` before the LLM scorer
sees it. `jobify.db.get_seen_ids()` deduplicates against past runs in
Supabase (PR-3 retired the JSON-state file).

## Tailor subtree (`jobify/tailor/`)

Polls Supabase for approved jobs, generates a tailored resume +
LaTeX-rendered PDF + cover letter + (optional) form answers, marks the
row `ready_to_submit` (or `ready_for_review` if human approval is
required). Materials live in Supabase Storage (`job-materials/{job_id}/`)
— never on disk except for ephemeral diagnostics in
`jobify.tailor.paths.OUTPUT_DIR`.

## Submit subtree (`jobify/submit/`)

### Contract with the tailor (input)

A job is eligible when the `jobs` row has:
- `status = 'prefilling'` (the cockpit's "Pre-fill Form" click; legacy
  aliases were retired by migration 011 — canonical statuses only)
- `resume_pdf_path` + `cover_letter_pdf_path` (Storage keys)
- `cover_letter_path` — plain-text body for form-paste fields
- `application_url` — canonical ATS URL (aggregator-resolved)
- `ats_kind` — one of: greenhouse, lever, ashby, workday, icims,
  smartrecruiters, linkedin, generic
- `materials_hash` — sha256 of resume PDF + CL text at approval time

If any required field is missing the submitter does not proceed; it
flips the row to `needs_review` with a reason.

### Contract with the dashboard (output)

Per attempt:
- `submission_log` (jsonb): structured events
- `confidence` (0–1): submitter's self-assessed readiness at submit time
- A row in `application_attempts` with outcome + Browserbase replay URL
- `status`: `submitted`, `needs_review`, or `failed`

### Architecture

```
runner.py (poll loop)
  └── router.py  (dispatch by ats_kind)
        ├── adapters/deterministic/greenhouse.py    deterministic Stagehand act() sequence
        ├── adapters/deterministic/lever.py         deterministic
        ├── adapters/deterministic/ashby.py         deterministic
        └── adapters/generic_stagehand.py           Stagehand Agent fallback
              │
              ▼
        browser/session.py  (Browserbase + Stagehand session)
              │
              ▼
        confirm.py  (decide auto-submit vs needs_review, verify success)
              │
              ▼
        review_packet.py  (build review packet if needs_review)
```

### Design rules

- **Adapters fill. `confirm.py` decides whether to submit.** Adapters
  NEVER click the final submit button; they return a `SubmissionResult`
  with evidence and a recommendation. `confirm.py` applies the uniform
  auto-vs-review policy.
- **One Browserbase session per attempt.** Always record. Hard-cap
  session budget via env var.
- **LLM use is bounded.** Only two places: (1) `confirm.py`'s
  post-submit page analysis, (2) `adapters/generic_stagehand.py`
  fallback. Deterministic adapters use zero LLM calls.
- **Every state transition writes a row to `application_attempts`.**
  Never update `jobs.status` to `submitted` without a corresponding
  attempts row showing the evidence.

## Where the data lives

- `jobs` table — main pipeline row (hunt writes; tailor / submit
  transition status)
- `application_attempts` — audit trail per submit attempt
- `notifications` — written by `jobify.notify`
- `star_stories` — interview prep stories (written by tailor's
  `interview_prep` module)
- `pattern_analyses` — closed-loop pattern analysis output
  (`jobify/tailor/scripts/analyze_patterns.py`)
- Supabase Storage `job-materials/{job_id}/` — resume.pdf,
  cover_letter.pdf, prefill.png, review/*.png
