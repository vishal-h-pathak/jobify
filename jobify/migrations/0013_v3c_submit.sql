-- 0013_v3c_submit.sql — V3c submitter: application profile + submit
-- telemetry (planning/V3C_DESIGN.md §8.1).
--
-- Additive on top of 0001-0012. Apply after 0012 is already applied.
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT
-- EXISTS / DROP POLICY IF EXISTS-then-CREATE), so re-running is safe.
--
-- Context (planning/V3C_DESIGN.md §8.1): V3c is the "submit packet" +
-- kit/extension submitter. This migration locks in the schema P0 and its
-- later engine phases (E1-E3) build on, so the shape doesn't shift under
-- them mid-program. Three tables:
--
--   application_profiles — one row per user, holding the submitter's
--     contact/EEO/work-auth answers etc. as ciphertext. Encrypted at rest
--     with the keycrypt `v1:<b64 nonce>:<b64 ciphertext+tag>` wire format
--     (AES-256-GCM, jobify/hosted/keycrypt.py on the Python side,
--     web/lib/crypto/keys.ts's encryptKey/decryptKey on the web side).
--     Service-role only — no `authenticated` policy at all. The client
--     never touches ciphertext directly (there is no admin surface that
--     renders this table), so every read/write goes through an authed
--     Next.js route using the service-role admin client, which decrypts/
--     encrypts server-side. RLS is enabled purely as defense-in-depth;
--     with zero policies, `authenticated`/`anon` get nothing.
--
--   submit_events — append-mostly telemetry for each kit/extension submit
--     attempt (source, final state, page count, per-field outcomes,
--     "wall" blockers, advance-agreement capture, cost). `field_outcomes`
--     stores labels/layer/outcome only — it NEVER stores the values a
--     human typed into a field. RLS: own-row SELECT (the dashboard can
--     show a user their own submit history), service-role ALL for
--     insert/update/delete (the kit/extension routes write via the admin
--     client). Nothing in the V3c P0 packet-only build writes to this
--     table yet — it's schema-locked now for the E2 engine phase.
--
--   learned_field_maps — the shared, structure-only field-mapping cache
--     (selectors/labels keyed by hostname + a field-signature hash),
--     global across users so one person's successful map benefits
--     everyone on the same ATS host. `mapping` NEVER stores field values,
--     only structure. Service-role only (no `authenticated` policy) —
--     served via a read API in E3; nothing reads or writes this table in
--     this session.

CREATE TABLE IF NOT EXISTS public.application_profiles (
  user_id           UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.application_profiles ENABLE ROW LEVEL SECURITY;
-- No `authenticated` policies here on purpose (see header comment):
-- service-role only, via authed Next.js routes that decrypt/encrypt
-- server-side. Do not add a policy for this table without re-reading
-- planning/V3C_DESIGN.md §8.1 first.


CREATE TABLE IF NOT EXISTS public.submit_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  posting_id          TEXT NOT NULL REFERENCES public.postings (id) ON DELETE CASCADE,
  source              TEXT NOT NULL CHECK (source IN ('kit', 'extension')),
  final_state         TEXT,
  pages               INT,
  field_outcomes      JSONB NOT NULL DEFAULT '[]',  -- [{label, layer, outcome}] — labels/layer/outcome only, NEVER the filled value
  walls               JSONB,
  advance_agreement   JSONB,
  cost_usd            NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.submit_events ENABLE ROW LEVEL SECURITY;

-- RLS: own-row SELECT (a user can see their own submit history).
-- INSERT/UPDATE/DELETE are service-role only — the kit/extension routes
-- write via the admin client.
DROP POLICY IF EXISTS submit_events_select_own ON public.submit_events;
CREATE POLICY submit_events_select_own ON public.submit_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS submit_events_service_all ON public.submit_events;
CREATE POLICY submit_events_service_all ON public.submit_events
  FOR ALL TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);


CREATE TABLE IF NOT EXISTS public.learned_field_maps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname          TEXT NOT NULL,
  ats_kind          TEXT,
  field_signature   TEXT NOT NULL,
  mapping           JSONB NOT NULL DEFAULT '{}',  -- structure only: selectors/labels — NEVER values
  verified_count    INT NOT NULL DEFAULT 0,
  last_verified_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS learned_field_maps_hostname_signature
  ON public.learned_field_maps (hostname, field_signature);

ALTER TABLE public.learned_field_maps ENABLE ROW LEVEL SECURITY;
-- Service-role only (no `authenticated` policy) — served via a read API
-- in E3; nothing reads or writes this table in this session.
