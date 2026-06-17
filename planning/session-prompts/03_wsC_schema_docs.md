# Session 03 — WS-C: Schema, infra & setup docs  (Wave 1)

**Run from:** `jobify/` (after Session 00).
**Depends on:** Session 00.
**Parallel-safe with:** WS-A1 (01), WS-B (02) — touches `migrations/`, `docs/`,
`.github/`, `.env.example` only (not the package internals or dashboard).

---

## Context

Production today = GitHub Actions (cron) + Supabase (data + storage) + Vercel
(dashboard). For the single-user local tool, a new user must be able to provision
their own Supabase project from clean migrations and run on their laptop with
their own keys. Read `jobify/planning/PROJECT_PLAN.md` §5 (WS-C) + §1.

## Goal

A clean schema baseline (kept tables only), scrubbed infra templates, and a
`SETUP.md` a technical friend can follow start-to-finish in well under an hour.

## Tasks

1. **Consolidate migrations** into `jobify/migrations/` as an ordered baseline
   that builds the schema from scratch for the KEPT tables only:
   `jobs`, `runs`, `application_attempts`, plus the `job-materials` storage
   bucket. **Drop** `star_stories` and `pattern_analyses` (and their columns/
   policies). Preserve the canonical job-status contract: `jobify/shared/status.py`
   → `status.json` → the Postgres CHECK constraint must still agree, and
   `tests/test_status_contract.py` must pass. Either squash the existing
   `001..013` into a single `0001_init.sql` baseline or keep them ordered but
   remove the dropped-table migrations — your call; document which.

2. **Scrub infra identifiers** across the repo: Supabase project id
   `sbmsxerwgylpfkkkjtku`, GitHub `vishal-h-pathak/job-pipeline`, any Vercel
   project refs, `vishal.pa.thak.io`. Replace with placeholders + env vars.

3. **`.env.example`** (pipeline, repo root): `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KEY`, `ANTHROPIC_API_KEY`,
   `CLAUDE_CODE_OAUTH_TOKEN` (optional Max-plan fallback), `SERPAPI_KEY`
   (optional), `JSEARCH_API_KEY` (optional), `RESEND_API_KEY`/`NOTIFY_*`
   (optional), `BROWSERBASE_*` (only if used), `JOBIFY_PROFILE_DIR`. Comment each
   as required/optional.

4. **`.github/workflows/`** — genericize: a `ci.yml` (pytest + the grep gate
   that Phase F will define — leave a stub), and an optional `hunt.yml` cron the
   user can enable on their own fork (documented). Remove repo-specific secrets
   names that don't apply; document the required secrets in SETUP.md.

5. **`docs/SETUP.md`** for a technical friend, in this order: clone → create a
   free Supabase project → apply `migrations/` (via Supabase SQL editor or CLI)
   → Python ≥3.11 venv + `pip install -e ".[dev]"` → `playwright install
   chromium` → fill `.env` with his own keys → run the onboarding skill to
   generate his `profile/` (point to `docs/ONBOARDING.md`, authored in WS-E) →
   `jobify-hunt --once` → dashboard: `cd dashboard && npm install`, fill
   `.env.local`, `npm run dev`. Call out the BYO-key requirement and which keys
   are optional.

6. **`docs/ARCHITECTURE.md`** — concise: the hunt → tailor → submit data flow,
   the `jobs.status` state machine, where materials live (Supabase Storage), and
   how the dashboard's three one-click actions drive status. (You can adapt the
   accurate parts of the old README/RUNBOOK; strip personal/infra specifics.)

## Exit criteria

- `migrations/` applies cleanly to a fresh Supabase project (no references to
  dropped tables).
- `tests/test_status_contract.py` passes.
- `grep -rEi "sbmsxerwgylpfkkkjtku|vishal-h-pathak|thak\.io"` over the repo is empty.
- Commit: `WS-C: clean schema baseline + scrubbed infra + SETUP/ARCHITECTURE docs`.
