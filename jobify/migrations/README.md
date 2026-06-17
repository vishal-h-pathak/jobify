# migrations/

The Supabase schema for jobify, as an ordered baseline you apply to a
**fresh** project. New install? You only ever run `0001_init.sql`.

## Apply it

Pick one:

- **SQL Editor** — open your Supabase project → SQL Editor → paste
  `0001_init.sql` → Run.
- **Supabase CLI** — `supabase db push` (or
  `supabase db execute --file jobify/migrations/0001_init.sql`).
- **MCP** — the `apply_migration` tool with the file contents.

It is idempotent (`IF NOT EXISTS` / `DROP … THEN ADD`), so re-running is
safe.

## What it builds

| Object | Purpose |
|---|---|
| `jobs` | the main pipeline row — hunt writes, tailor/submit transition `status` |
| `runs` | dashboard-triggered hunt/tailor runs (the RunsPanel) |
| `application_attempts` | per-submit audit trail |
| `job-materials` (Storage bucket, private) | generated PDFs + cockpit screenshots |

All three tables have **RLS enabled with no policies** — jobify runs
service-role only (see the root `README.md` "Supabase key contract" and
`.env.example`).

## Squash provenance

`0001_init.sql` squashes the original thirteen incremental migrations
into one clean baseline. The history is preserved here for reference;
the individual files were removed because a fresh install never needs to
replay them.

| Original | Folded into baseline as |
|---|---|
| `migration.sql` | `jobs` status/application columns |
| `migration_storage.sql` | `jobs` storage-path columns + `job-materials` bucket |
| `001_redesign.sql` | `jobs` submit columns + `application_attempts` |
| `003_legitimacy.sql` | `jobs.legitimacy*` + CHECK + index |
| `004_archetype.sql` | `jobs.archetype*` + index |
| `007_career_ops_alignment.sql` | `jobs.form_answers` + stop-at-submit columns + status CHECK |
| `008_runs.sql` | `runs` table |
| `009_runs_tailor_manual.sql` | `runs.kind = 'tailor_manual'` + `runs.result` |
| `010_degree_gated.sql` | `jobs.degree_gated` + `jobs.rescored_at` |
| `011_canonical_status.sql` | the canonical `jobs_status_check` constraint |
| `012_response_outcomes.sql` | `jobs.response_status` + `jobs.responded_at` |
| `013_link_status.sql` | `jobs.link_status` |

### Dropped on the way to single-user

Two subsystems were trimmed and their tables are **not** created:

- `005_star_stories.sql` → `star_stories` (interview-prep STAR bank)
- `006_pattern_analyses.sql` → `pattern_analyses` (closed-loop insights)

No kept code path reads either table.

## The status contract

The canonical `jobs.status` enum lives in **three** places that must
agree, pinned by `tests/test_status_contract.py`:

1. `jobify/shared/status.py` → `CANONICAL_STATUSES` (the source of truth)
2. `jobify/shared/status.json` (generated artifact the dashboard consumes)
3. the `jobs_status_check` CHECK constraint in `0001_init.sql`

To change the enum: edit the tuple in `status.py`, regenerate the JSON
(`python -m jobify.shared.status`), update the `ADD CONSTRAINT
jobs_status_check` block in `0001_init.sql`, and add a new
`0002_*.sql` migration with the `ALTER TABLE … ADD CONSTRAINT` for
already-provisioned projects.

## Adding future migrations

New schema changes go in `0002_*.sql`, `0003_*.sql`, … (ordered). Keep
each additive and idempotent. The baseline is only re-squashed when the
incremental count gets unwieldy.
