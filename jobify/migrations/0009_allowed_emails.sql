-- 0009_allowed_emails.sql — friend allowlist: codeless signup (SGN-1).
--
-- Additive on top of 0001-0008. Apply after 0008 is already applied.
-- Idempotent (`CREATE TABLE IF NOT EXISTS`), so re-running is safe.
--
-- Context (planning/session-prompts/23_signup_allowlist.md): the operator
-- adds a friend's email here ahead of time. When that email first signs in
-- (magic link), the auth callback auto-mints and auto-claims an invite for
-- them and routes straight to onboarding — no invite code needed. Everyone
-- else keeps the existing invite-code flow untouched.
--
-- PII posture: this table holds a third party's email before they've ever
-- consented to an account. Keep it minimal (email + an optional short
-- note), delete rows freely. RLS is enabled with NO policies — service-role
-- only, same posture as `invites` (0003) — users never read it, not even
-- their own row.

CREATE TABLE IF NOT EXISTS public.allowed_emails (
  email        TEXT PRIMARY KEY,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_by  UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  consumed_at  TIMESTAMPTZ,
  CONSTRAINT allowed_emails_email_lowercase_check CHECK (email = lower(email))
);

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;
