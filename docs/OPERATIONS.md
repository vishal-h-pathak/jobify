# OPERATIONS — running jobify cloud for friends

The ops runbook for the hosted aggregator (`planning/HOSTED_AGGREGATOR_PLAN.md`,
H7 of the hosted wave). Audience: Vishal, operating the live Supabase project
(`vujlecpmurismvnjebcf`), the Vercel deploy of `web/`, and the
`.github/workflows/hosted-hunt.yml` cron. For the budget mechanics themselves
see [`docs/COST_RAILS.md`](COST_RAILS.md); for the scoring ladder see
[`docs/SCORING.md`](SCORING.md).

---

## 1. Env / secret inventory

Three surfaces, three different places secrets live. Nothing here is
optional-by-omission except where marked — an unset optional var degrades
gracefully (documented per-row), it never crashes.

| Variable | GHA (`hosted-hunt.yml`) | Vercel (`web/`) | Local dev | Purpose |
|---|---|---|---|---|
| `SUPABASE_URL` | required | — | required | Service-role Python client target. |
| `NEXT_PUBLIC_SUPABASE_URL` | — | required | required (`web/.env.local`) | Same project URL, browser-exposed. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | required | required | Browser/server anon client (RLS-scoped). |
| `SUPABASE_SERVICE_ROLE_KEY` | required | required | required | Bypasses RLS. Python worker + `web`'s server-only `budget_ledger`/admin routes. Never ship to the browser. |
| `ANTHROPIC_API_KEY` | required | required | required | The funded pool key — rubric compiles, stage-4 verdicts, onboarding chat. |
| `CLAUDE_CODE_OAUTH_TOKEN` | optional | — | optional | Max-plan OAuth fallback when the API key is unset/benched (`jobify.shared.llm`). |
| `VOYAGE_API_KEY` | optional | — | optional | Stage-3 embeddings (`jobify.hosted.embed`). Unset = stage 3 cleanly skipped, ladder still runs 1→2→4. |
| `JOBIFY_KEY_ENCRYPTION_SECRET` | required once any user has a BYO key | required (same value) | optional | AES-256-GCM secret, shared by both runtimes, decrypts/encrypts BYO Anthropic keys. See §4 for minting + rotation. |
| `NTFY_TOPIC` | optional | — | optional | Cycle-telemetry push (one line per `jobify-hosted-hunt` run). Unset = skip silently. |
| `HOSTED_GLOBAL_MONTHLY_CAP_USD` | optional (default `100`) | — | optional | Override the $100/month total non-BYO pool cap. |
| `SERPAPI_KEY`, `JSEARCH_API_KEY` | optional | — | optional | Paid discovery sources, unioned across every hosted user. |
| `ONBOARDING_CLAUDE_MODEL` | — | optional (default `claude-sonnet-5`) | optional | Onboarding chat's model override. |

Setting GHA secrets (values piped, never pasted into argv or echoed):

```bash
gh secret set SUPABASE_URL --body "https://vujlecpmurismvnjebcf.supabase.co"
printf '%s' "$SERVICE_ROLE_KEY" | gh secret set SUPABASE_SERVICE_ROLE_KEY
printf '%s' "$ANTHROPIC_API_KEY" | gh secret set ANTHROPIC_API_KEY
printf '%s' "$KEY_ENCRYPTION_SECRET" | gh secret set JOBIFY_KEY_ENCRYPTION_SECRET
# ...repeat per secret, always piping stdin rather than passing --body with
# a literal value that would land in shell history.
```

Setting Vercel env vars (per environment — at minimum Production):

```bash
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add JOBIFY_KEY_ENCRYPTION_SECRET production
# ...prompts for the value, doesn't echo it back.
```

---

## 2. Minting and distributing invites

`jobify-hosted-invite` (service-role, run locally or anywhere `pip install
-e .` + the repo's `.env` are available — never wire this into a public-facing
surface, it's operator-only):

```bash
jobify-hosted-invite --mint 5      # prints 5 fresh codes, one per line
jobify-hosted-invite --list        # shows every code + claimed_by/claimed_at
```

Distribute a code as a link: `https://<vercel-prod-url>/invite?code=<code>`
(or just hand over the bare code — the `/invite` page has a manual-entry
field too). Codes are single-use (`invites_claim_unclaimed`'s RLS policy
only allows a claim while `claimed_by IS NULL`); minting more costs nothing
and there's no expiry, so over-minting is harmless — under-minting just means
running the command again.

---

## 3. `JOBIFY_KEY_ENCRYPTION_SECRET` — minting and rotation

Mint a fresh secret:

```bash
openssl rand -base64 32
```

Set the same value in both GHA (`gh secret set`) and Vercel (`vercel env
add`) — the wire format (`v1:<nonce>:<ciphertext+tag>`) is cross-runtime, but
both sides must share the same secret or every BYO key becomes
undecryptable.

**Rotation policy: invalidate, don't re-encrypt.** Full mechanics and
rationale live in [`docs/COST_RAILS.md`](COST_RAILS.md#rotating-jobify_key_encryption_secret).
Short version: rotating breaks every existing `api_keys.encrypted_key` row
on purpose. Nothing crashes — `jobify.hosted.keycrypt.KeyDecryptionError`
degrades an affected user to the pool-with-caps path for that cycle — but
their pool spend resumes counting against the shared cap until they re-paste
their key on the settings page. Communicate the rotation to BYO users out of
band; the worker has no way to notify them proactively.

---

## 4. Admin SQL snippets

Run these in the Supabase SQL Editor (service-role context; RLS doesn't
apply there).

**Pool spend MTD by user:**
```sql
select user_id, round(sum(cost_usd)::numeric, 4) as spend_usd
from budget_ledger
where byo = false
  and created_at >= date_trunc('month', now())
group by user_id
order by spend_usd desc;
```

**Matches per user:**
```sql
select user_id, count(*) as total,
       count(*) filter (where state = 'saved') as saved,
       count(*) filter (where state = 'applied') as applied
from matches
group by user_id
order by total desc;
```

**Invite status:**
```sql
select code, claimed_by is not null as claimed, claimed_at, created_at
from invites
order by created_at desc;
```

**`validation_status` errors (profiles the worker is skipping):**
```sql
select user_id, validation_status->>'status' as status,
       validation_status->'errors' as errors
from profiles
where validation_status->>'status' = 'invalid';
```

---

## 5. "Friend can't get in" triage checklist

1. **Magic link never arrives** — check Supabase Auth logs (dashboard →
   Authentication → Logs) for a send failure; confirm Site URL / redirect
   allowlist includes the Vercel prod URL (see the H7 Part B deploy step).
2. **Magic link bounces back to `/login`** — usually a Site URL / redirect
   URL mismatch, not an expired link. Re-check Auth settings.
3. **"Invalid invite code"** — run `jobify-hosted-invite --list` and confirm
   the code exists and `claimed_by` is still null. A zero-rows claim update
   means either a typo, an already-claimed code, or (rarely) RLS drift —
   check `invites_claim_unclaimed`'s policy is still in place via `select *
   from pg_policies where tablename = 'invites'`.
4. **Onboarding chat won't finish / feed is empty after a day** — check
   `profiles.validation_status` (§4's snippet). `'invalid'` means the
   fan-out worker is skipping that user every cycle; the feed's own
   profile-health banner should already be telling them what's wrong.
5. **Feed never populates even with a valid profile** — confirm the cron
   actually ran (`gh run list --workflow=hosted-hunt.yml`) and check the
   cycle's ntfy summary / GHA logs for `users_skipped_invalid` /
   `users_errored` / `users_budget_stopped` counts against that user.
6. **BYO key not working** — a decrypt failure degrades silently to the
   pool path (by design, see §3); check `budget_ledger` for that user's
   recent rows — `byo = false` rows appearing where the user expects `byo =
   true` means their stored key failed to decrypt (likely a secret
   rotation they haven't re-pasted past) or the key itself is invalid/out
   of credits at Anthropic.
