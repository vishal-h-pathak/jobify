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

## 0002 — hosted multi-tenant tables

`0002_multitenant.sql` is additive on top of `0001_init.sql` — H1 of the
hosted-aggregator plan (`planning/HOSTED_AGGREGATOR_PLAN.md` §3). It adds:

| Table | Purpose |
|---|---|
| `profiles` | one row per hosted user — the 8-file profile contract as JSONB, plus compiled rubric + embedding |
| `postings` | **global** job postings pool (no `user_id`) — discovery/embeddings amortize across every user |
| `matches` | `user_id x posting_id` — ladder scores + its own state machine (`new -> seen -> saved \| dismissed \| applied`, see `jobify/shared/match_state.py`). Separate from `jobs.status` — that contract is untouched. |
| `budget_ledger` | append-only per-user token/cost events |
| `budget_caps` | per-user monthly spend cap, service-role-managed |
| `api_keys` | optional BYO Anthropic key (ciphertext only — app-side encryption is H6) |

`0001`'s tables keep their RLS-enabled-no-policies / service-role-only
posture. The new tables get real RLS policies (own-row select/insert/update
via `auth.uid() = user_id`, no delete; `postings` is select-all-authenticated,
write-locked to service-role) — see the header comment in
`0002_multitenant.sql` for the exact policy-by-policy rationale.

Apply it the same way as `0001` (SQL Editor / `supabase db push` /
`apply_migration`), after `0001` is already applied.

## 0003 — invite gate + onboarding chat

`0003_hosted_onboarding.sql` is additive on top of `0001_init.sql` +
`0002_multitenant.sql` — H3 of the hosted-aggregator plan
(`planning/HOSTED_AGGREGATOR_PLAN.md` §2, `planning/session-prompts/
12_h3_onboarding_web.md`). It adds:

| Object | Purpose |
|---|---|
| `invites` | one row per invite code; service-role creates, an authed user claims an unclaimed code for themselves via a conditional `UPDATE` |
| `profiles.validation_status` | new column: `{"status": "unchecked" \| "valid" \| "invalid", "errors": [...]}` — the web app's TS validator writes `unchecked`/`valid`; H4's worker overwrites with the authoritative Python validator's verdict at materialization time |
| `onboarding_sessions` | server-side onboarding-chat state keyed by `user_id` (transcript + extracted structured data), so a dropped connection resumes instead of restarting |

`invites` intentionally has no general SELECT policy — only a user's own
*claimed* row is visible, so an unclaimed code can't be enumerated by
reading the table; claiming is the single conditional `UPDATE` in the
migration's header comment. `onboarding_sessions` follows the same
own-row select/insert/update shape as `profiles` (no delete — a completed
session just flips `status`).

Apply it the same way as `0001`/`0002` (SQL Editor / `supabase db push` /
`apply_migration`), after both are already applied.

### Running the isolation tests

`tests/test_rls_multitenant.py` (marked `@pytest.mark.integration`)
exercises RLS in both directions against a real Postgres — it needs a
live Supabase stack, so it skips cleanly (not a failure) when one isn't
configured:

```bash
supabase start                       # from a supabase-cli project dir with 0001+0002 applied
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=<service_role from `supabase status`>
export SUPABASE_ANON_KEY=<anon from `supabase status`>
pytest -m integration tests/test_rls_multitenant.py -v
```

The match-state contract (`jobify/shared/match_state.py` <-> `match_state.json`
<-> `matches_state_check`) is pinned by `tests/test_match_state_contract.py`,
which runs in the default (non-integration) suite — no live DB needed.

## 0004 — hosted worker fan-out support

`0004_worker.sql` is additive on top of `0001` + `0002` — H4 of the hosted
plan. It adds one column:

| Column | Purpose |
|---|---|
| `profiles.validation_status` | free-text `'valid'` / `'invalid'` (or `NULL` if never checked), written each time `jobify.profile_loader.materialize_profile_dir(user_id)` re-materializes a user's profile from `profiles.doc` and runs `onboarding/validate_profile.py`'s checks against it. The fan-out worker skips scoring for any user whose latest verdict is `'invalid'` rather than silently running their rubric against a broken profile. |

**Note:** the concurrent H3 session prompt (`planning/session-prompts/12_h3_onboarding_web.md`,
task 2) also describes a `profiles.validation_status` column, as `jsonb`,
in its own `0003_hosted_onboarding.sql`. That's a genuine naming
collision between the two parallel sessions this migration wasn't written
to reconcile — flagged for the controller to resolve at merge time
(rename one, fold into the other, or pick one column shape) rather than
decided unilaterally here.

## 0006 — cost rails: hard caps, global pool, BYO keys

`0006_cost_rails.sql` is additive on top of `0001`-`0005` — H6 of the
hosted plan (`planning/HOSTED_AGGREGATOR_PLAN.md` §4,
`planning/session-prompts/15_h6_cost_rails.md`). This phase is the launch
blocker: no invites go out until it merges. It adds:

| Object | Purpose |
|---|---|
| `api_keys.key_last4` | the only fragment of a BYO key the settings UI ever echoes back post-save |
| `api_keys.updated_at` | parity with every other per-user table; a paste-new-key is an UPDATE |
| `api_keys` DELETE policy | 0002 shipped none (own-row select/insert/update only) — the settings page's "remove key" needs it |
| `budget_ledger.byo` | `TRUE` for a rubric compile / stage-4 verdict run on the user's own decrypted key; excludes that row from both the per-user and global pool-spend sums (see `docs/COST_RAILS.md`) |

See `docs/COST_RAILS.md` for the three budget layers (per-user cap, global
pool cap, BYO bypass), the BYO key encryption format, and the
`JOBIFY_KEY_ENCRYPTION_SECRET` rotation runbook.

Apply it the same way as `0001`-`0005` (SQL Editor / `supabase db push` /
`apply_migration`), after `0005` is already applied.

## 0012 — hosted tailor tracking

`0012_v3b_tailor.sql` is additive on top of `0001`-`0011` — V3b tailor worker
support (`planning/V3B_DESIGN.md` §1.3). Moves resume tailoring to a hosted GHA
compute plane with async status tracking. It adds:

| Object | Purpose |
|---|---|
| `tailor_runs` | async tailor run lifecycle tracking — one row per dispatch, worker updates in place with status/progress/outcome |
| `tailor_runs_one_active` unique index | per-posting cooldown — enforces at most one queued/running tailor per (user_id, posting_id); second dispatch while one is in-flight fails with unique-violation |
| `tailor_runs` RLS | own-row SELECT for polling; INSERT/UPDATE service-role only |
| `job-materials` storage policy | user-scoped path prefix — reads gated to own folder `(storage.foldername(name))[1] = auth.uid()::text` |

Apply it the same way as `0001`-`0011` (SQL Editor / `supabase db push` /
`apply_migration`), after `0011` is already applied.
