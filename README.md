# job-pipeline

Unified Python pipeline consolidating the previously-separate
`job-hunter`, `job-applicant`, and `job-submitter` repos into a single
codebase.

## Status

Mid-migration. The three sub-repos were merged here in PR-0a via
`git filter-repo --to-subdirectory-filter` followed by
`git merge --allow-unrelated-histories`, which preserves full commit
history per file (`git log --follow` works across the merge).

PR-0 (this commit) adds the top-level skeleton. PR-1..PR-10 reorganize
and consolidate the code; see the migration plan for details.

## Layout during migration

```
jobify/
├── hunt/    # was job-hunter   — sources, scorer, agent, profile
├── tailor/  # was job-applicant — form_answers, prompts, interview_prep
└── submit/  # was job-submitter — adapters, router, confirm
```

The post-migration target layout is documented in the migration plan.

## History walkback

`git log --follow` walks back into the original repos' history. Note
the file renames performed by PR-3 / PR-4 / PR-5; pass the post-rename
paths to walk through the merge:

```
git log --follow jobify/hunt/agent.py        # was jobify/hunt/job_agent.py (PR-3)
git log --follow jobify/tailor/pipeline.py   # was jobify/tailor/main.py    (PR-4)
git log --follow jobify/submit/runner.py     # was jobify/submit/main.py    (PR-5)
```

`git blame` attributes lines to their original pre-merge commits.

## Development

```
pip install -e '.[dev]'
pytest
```

### Supabase key contract

The pipeline tables (`jobs`, `runs`, `application_attempts`) have RLS
enabled with **no anon policies** — an anon key gets HTTP 200 and empty
result sets, no error. jobify therefore runs **service-role only**:
`jobify.db` resolves its client from `SUPABASE_SERVICE_ROLE_KEY`
(falling back to `SUPABASE_KEY`, which in GitHub Actions also holds the
service-role key) and raises at startup if the resolved key is
demonstrably anon. Put the service-role key in your local `.env` as
`SUPABASE_SERVICE_ROLE_KEY`.

### Canonical job statuses

`jobify/shared/status.py` is the single source of truth for the
`jobs.status` enum; `jobify/shared/status.json` is its generated
artifact (regenerate with `python -m jobify.shared.status`), consumed
by the portfolio dashboard's type generator. The Postgres CHECK
constraint mirrors the same list
(`jobify/tailor/scripts/011_canonical_status.sql`).
`tests/test_status_contract.py` fails CI if any of the three drift.
