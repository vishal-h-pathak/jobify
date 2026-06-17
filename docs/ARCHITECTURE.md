# ARCHITECTURE

jobify is a single-user, local job-application pipeline with three
phases — **hunt → tailor → submit** — plus a thin Next.js **dashboard**
that drives them. State lives in Supabase (Postgres + Storage); generated
materials live in a private Storage bucket. The only LLM it calls is
Anthropic's Claude, and only at a few bounded points.

```
            ┌──────────┐      ┌──────────┐      ┌──────────┐
  sources ─▶│   HUNT   │─────▶│  TAILOR  │─────▶│  SUBMIT  │──▶ live ATS form
            │ discover │      │ resume + │      │ pre-fill │    (you click
            │ + score  │      │ CL + ans │      │ (visible │     the site's
            └────┬─────┘      └────┬─────┘      │ browser) │     own Submit)
                 │                 │            └────┬─────┘
                 ▼                 ▼                 ▼
            ┌─────────────────────────────────────────────┐
            │   Supabase: jobs · runs · application_attempts│
            │   Storage bucket: job-materials/{job_id}/     │
            └─────────────────────────────────────────────┘
                 ▲                 ▲                 ▲
                 └──────── Dashboard (3 one-click actions) ─┘
```

## The data flow

**Hunt** (`jobify-hunt`, `jobify/hunt/`). Pulls postings from pure
HTTP/JSON + RSS sources (no LLM tokens spent on discovery). Each posting
is title-pre-filtered, deduped against `jobs` by a deterministic id
(`jobify.shared.jobid`), then the surviving ones are LLM-scored against
*your* profile (fit + legitimacy + degree-gate). The discovery gate also
resolves aggregator links to the real ATS URL and records `link_status`.
Results are upserted into `jobs` at `status = 'new'`.

**Tailor** (`jobify-tailor`, `jobify/tailor/`). Polls `jobs` for
`approved` rows, generates a tailored resume (LaTeX → PDF), a cover
letter, and optional form-answer drafts, uploads them to
`job-materials/{job_id}/`, and moves the row to `ready_for_review` (no
browser opened). PR-13 split this from submit so an automated trigger can
tailor without a visible browser.

**Submit** (`jobify-submit`, `jobify/tailor/pipeline:run_submit_only`).
For rows you clicked "Pre-fill Form" on (`status = 'prefilling'`), it
opens the live application in a **local visible Chromium** (Playwright),
fills every field from your profile / `application_defaults`, screenshots
it, and **stops before the final submit** (`awaiting_human_submit`). You
review in the open browser and click the site's own Submit. jobify never
sends that click. Per-ATS DOM fillers cover Greenhouse / Lever / Ashby;
a generic fallback handles the rest. (A retired Browserbase-hosted path
lives at `jobify/submit/runner_legacy.py` and is not wired to any
console script.)

## The `jobs.status` state machine

The canonical lifecycle (single source of truth:
`jobify/shared/status.py` → `status.json` → the `jobs_status_check`
Postgres constraint, all pinned by `tests/test_status_contract.py`):

```
discovered (alias: new)
     │  user approves in the dashboard
     ▼
  approved ──▶ preparing ──▶ ready_for_review
                                  │  user clicks "Pre-fill Form"
                                  ▼
                             prefilling ──▶ awaiting_human_submit
                                                  │  user clicks "Mark Applied"
                                                  ▼
                                               applied        (terminal, positive)

  terminals (from various states): failed · skipped · expired · ignored
```

Rules that matter:

- **The system never auto-sets `applied`.** Only the dashboard's "Mark
  Applied" click does — that human action is the single source of truth
  for whether a job was actually submitted.
- **What the employer does next is a separate axis** (`response_status`:
  none → rejected | screen | interview | offer), not a pipeline status.
- **Every submit-phase transition writes an `application_attempts` row**
  with evidence. `jobs.status` never reaches a submit outcome without a
  matching attempts row.

## Where materials live

Generated artifacts are **never** kept on disk (except ephemeral
diagnostics). They live in the private Supabase Storage bucket
`job-materials/{job_id}/`:

```
job-materials/{job_id}/
  ├── resume.pdf
  ├── cover_letter.pdf
  ├── prefill.png        # post-prefill screenshot shown in the cockpit
  └── review/*.png
```

The bucket is `public = false`; the dashboard reads via service-role
signed URLs only.

## The dashboard's three one-click actions

The trimmed cockpit (carved from the original portfolio site) keeps the
job triage/browse list, the review cockpit, and a runs panel. Each action
is one click that drives a `jobs.status` transition:

| Button | Effect |
|---|---|
| **Hunt** | dispatches a hunt run (a `runs` row + GitHub Actions `hunt.yml`), surfacing new `jobs`. |
| **Tailor** | moves an `approved` row through `preparing` → `ready_for_review`, generating materials. |
| **Pre-fill Form** | flips a row to `prefilling`; the local submit path opens the filled form and parks it at `awaiting_human_submit`. |

The review cockpit then exposes the materials, copy-able form answers, and
the **Mark Applied / Skip / Mark Failed** transitions. A
`DASHBOARD_PASSWORD` gate fronts the whole thing.

## Bounded LLM use

- Hunt: scoring each surviving posting (one call per posting).
- Tailor: resume/cover-letter/form-answer generation.
- Submit: only the generic fallback adapter and post-page analysis;
  the deterministic per-ATS DOM fillers spend zero LLM tokens.

## Where the data lives (tables)

| Table | Written by | Purpose |
|---|---|---|
| `jobs` | hunt (insert), tailor/submit (transition) | the main pipeline row |
| `runs` | dashboard / cron | audit of dashboard-triggered hunt/tailor runs |
| `application_attempts` | submit | per-attempt audit trail + evidence |
| `job-materials` (Storage) | tailor/submit | generated PDFs + screenshots |

See [`jobify/migrations/0001_init.sql`](../jobify/migrations/0001_init.sql)
for the full schema.
