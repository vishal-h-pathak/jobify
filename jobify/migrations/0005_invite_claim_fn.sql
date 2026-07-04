-- 0005_invite_claim_fn.sql — fix the invite-claim path (real-stack RLS finding).
--
-- Found during live verification on the provisioned Supabase project
-- (2026-07-03): Postgres requires rows targeted by an UPDATE whose WHERE
-- clause reads table columns to ALSO pass the SELECT policy. 0003's
-- anti-enumeration SELECT policy (`claimed_by = auth.uid()`) makes
-- unclaimed invites invisible to authed users, so the claim UPDATE
-- (`invites_claim_unclaimed`) matched 0 rows — the invite gate could never
-- be passed in production. Fakes and the PGlite apply-check didn't exercise
-- the claim-as-authenticated path; the live check did.
--
-- Fix: a SECURITY DEFINER function owns the claim. It preserves both
-- properties 0003 wanted: no code enumeration (SELECT policy unchanged)
-- and atomic first-claimer-wins (single UPDATE ... WHERE claimed_by IS
-- NULL). The now-dead UPDATE policy is dropped.

CREATE OR REPLACE FUNCTION public.claim_invite(invite_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  UPDATE public.invites
     SET claimed_by = auth.uid(),
         claimed_at = now()
   WHERE code = invite_code
     AND claimed_by IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_invite(TEXT) TO authenticated;

-- Dead since it could never match (see header); the function replaces it.
DROP POLICY IF EXISTS invites_claim_unclaimed ON public.invites;
