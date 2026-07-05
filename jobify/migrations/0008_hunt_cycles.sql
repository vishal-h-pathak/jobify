-- 0008_hunt_cycles.sql — admin System screen: hunt cycle audit table (ADM-2).
--
-- Additive on top of 0001-0007. Apply after 0007 is already applied.
-- Idempotent (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`), so
-- re-running is safe.
--
-- Context (planning/session-prompts/22_admin_system_screen.md): the System
-- admin page displays a live feed of recent hunt cycles (last 15), one row per
-- daemon invocation. hunt_cycles records the cycle metadata: start/finish time,
-- mode (full, discovery_only, or single_user), how it was triggered (cron,
-- dispatch, or manual), counters (users scored, postings fetched/upserted),
-- total cost, and error (if any). Service-role-only table (no RLS policies —
-- admin page reads via gated service-role client in web/lib/admin/requireAdmin.ts).

CREATE TABLE IF NOT EXISTS public.hunt_cycles (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at         TIMESTAMPTZ NOT NULL,
  finished_at        TIMESTAMPTZ,
  mode               TEXT NOT NULL,
  triggered_by       TEXT,
  users_scored       INTEGER NOT NULL DEFAULT 0,
  postings_fetched   INTEGER NOT NULL DEFAULT 0,
  postings_upserted  INTEGER NOT NULL DEFAULT 0,
  counters           JSONB,
  cost_usd           NUMERIC(10, 6) NOT NULL DEFAULT 0,
  error              TEXT
);

CREATE INDEX IF NOT EXISTS hunt_cycles_started_at_idx ON public.hunt_cycles (started_at DESC);

ALTER TABLE public.hunt_cycles ENABLE ROW LEVEL SECURITY;
