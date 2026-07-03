-- 0004_worker.sql — hosted fan-out worker support (H4).
--
-- Additive on top of 0001_init.sql + 0002_multitenant.sql. Apply to a
-- project that already has both (SQL Editor, `supabase db push`, or the
-- MCP `apply_migration` tool). `ADD COLUMN IF NOT EXISTS` is idempotent,
-- so re-running is safe, and additive-nullable is safe on a `profiles`
-- table that already has rows in prod.
--
-- Context (planning/HOSTED_AGGREGATOR_PLAN.md §4, H4 session prompt): the
-- hosted worker materializes each user's profile out of `profiles.doc`
-- into a per-process cache dir before scoring against it
-- (`jobify.profile_loader.materialize_profile_dir`). That materialization
-- runs the same validator the onboarding flow uses
-- (`onboarding/validate_profile.py`) and now GATES scoring on the result
-- instead of only logging a warning: an invalid profile must never be
-- silently scored against a friend's postings.
--
-- validation_status is a simple TEXT convention, not a CHECK-constrained
-- enum (matching budget_ledger.event's precedent in 0002): 'valid' or
-- 'invalid', written by `jobify.profile_loader._validate_materialized`
-- via `jobify.db.set_profile_validation_status`. NULL means "never
-- materialized/validated yet" (e.g. a profile written directly by
-- onboarding that the worker hasn't picked up for a scoring run).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS validation_status TEXT;


-- ══════════════════════════════════════════════════════════════════════════
--  budget_ledger.user_id → nullable (H4 Task 2: embeddings)
-- ══════════════════════════════════════════════════════════════════════════
-- `budget_ledger.user_id` was NOT NULL in 0002_multitenant.sql, but posting
-- embeddings (jobify.hosted.embed.ensure_posting_embedding) are a GLOBAL
-- cost: a shared posting is embedded ONCE and reused by every user's
-- match, so no single user owns that spend. Loosening a NOT NULL
-- constraint is additive/safe — it never breaks existing rows, all of
-- which already have a non-null user_id. Profile-embedding ledger rows
-- (jobify.hosted.embed.ensure_profile_embedding) keep writing the
-- specific user_id; only the global posting-embedding rows use NULL.

ALTER TABLE budget_ledger ALTER COLUMN user_id DROP NOT NULL;
