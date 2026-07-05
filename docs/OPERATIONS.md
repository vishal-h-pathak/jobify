# OPERATIONS — running jobify cloud for friends

The ops runbook for the hosted aggregator (`planning/HOSTED_AGGREGATOR_PLAN.md`,
H7 of the hosted wave). Audience: the operator of the live Supabase project
(`vujlecpmurismvnjebcf`), the Vercel deploy of `web/`, and the
`.github/workflows/hosted-hunt.yml` cron. For the budget mechanics themselves
see [`docs/COST_RAILS.md`](COST_RAILS.md); for the scoring ladder see
[`docs/SCORING.md`](SCORING.md).

**Prod URL:** https://jobify-swart.vercel.app (Vercel project: see the
Vercel dashboard or `vercel project ls` — org/project slugs are operator-
identifying, so they live outside the repo; deployed from `web/` in H7 Part B,
2026-07-03). Invite links: `https://jobify-swart.vercel.app/invite?code=<code>`.

**Deploy model (confirmed 2026-07-04): NO GitHub auto-deploy.** The project
was created via the CLI, so pushes to GitHub do NOT deploy — the dashboard's
"Redeploy" only re-runs the previous CLI upload (this bit us: prod served
pre-UX code while main was five merges ahead). Until/unless the GitHub
integration is connected (requires setting Root Directory = `web` in project
settings first, or builds target the repo root and fail), **every merge to
main must be followed by:**

```
cd <repo>/web && vercel --prod
```

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
| `ADMIN_EMAILS` | — | optional | optional | Comma-separated emails (case-insensitive, trimmed) that can reach `/admin`. Unset = nobody is admin. See §6. |
| `GITHUB_DISPATCH_TOKEN` | — | required (for user-triggered hunts) | optional | Fine-grained GitHub PAT, Actions read/write on the repo. `POST /api/hunt/run` (web) uses it to dispatch `hosted-hunt.yml`. Never a repo secret literal — env var only, server-only, never sent to the browser. Unset = the trigger route 503s (logged) rather than crashing. |
| `GITHUB_REPO` | — | required (for user-triggered hunts) | optional | `owner/repo` slug of this repo. Env var, NOT hardcoded — the opensource scrub gate forbids the real slug appearing as a literal in code. |
| `HUNT_COOLDOWN_HOURS` | — | optional (default `6`) | optional | Minimum hours between one user's own hunt triggers. Admins bypass it entirely (their own and anyone else's, via the admin panel's per-row button). See §7. |

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
4. **Onboarding chat won't finish / feed stays empty after they've hit "Run
   my hunt"** — check `profiles.validation_status` (§4's snippet).
   `'invalid'` means fan-out skips that user every run; the feed's own
   profile-health banner should already be telling them what's wrong.
5. **Feed never populates even after clicking "Run my hunt"** — scoring is
   user-triggered now (HNT-1, §7), not automatic — confirm the dispatched
   run actually ran (`gh run list --workflow=hosted-hunt.yml`) and check
   the cycle's ntfy summary / GHA logs for `users_skipped_invalid` /
   `users_errored` / `users_budget_stopped` counts against that user. A
   429 in the browser means they're still in cooldown (§7) — check
   `profiles.last_hunt_requested_at` for that user.
6. **BYO key not working** — a decrypt failure degrades silently to the
   pool path (by design, see §3); check `budget_ledger` for that user's
   recent rows — `byo = false` rows appearing where the user expects `byo =
   true` means their stored key failed to decrypt (likely a secret
   rotation they haven't re-pasted past) or the key itself is invalid/out
   of credits at Anthropic.

---

## 6. Admin panel

`/admin` (web, ADM-1) is a lightweight in-app alternative to the SQL
snippets in §4 and the `jobify-hosted-invite` CLI in §2 — three read-mostly
cards (Invites, Users, Pool health) for day-to-day ops, no SQL Editor
required.

**Who can reach it — `ADMIN_EMAILS`.** Set the env var (comma-separated,
case-insensitive, trimmed) on Vercel (`vercel env add ADMIN_EMAILS
production`) to the operator's own email(s). There is no admin flag in the
DB and no client-side secret — `lib/admin/isAdmin.ts` reads
`process.env.ADMIN_EMAILS` server-side on every request. Unset means
nobody is admin; the "Admin" nav link only renders for admins, but every
`/admin` page load and `/api/admin/*` route re-checks server-side
regardless (the link is a convenience, not the security boundary).

**Admins bypass the invite gate.** An admin's own account may never have
claimed an invite code (there's no reason to spend one on yourself), so
the `(app)` layout and the onboarding API routes treat "has a claimed
invite OR is an admin" as passing. This only affects those specific
gates — an admin still needs a real Supabase Auth session (magic link)
like anyone else.

**Minting invites — UI vs CLI.** The panel's "Mint invite" button (N =
1/3/5) hits `POST /api/admin/invites` and calls the same
`jobify-hosted-invite --mint`-equivalent code-generation shape (12-char
lowercase base64url) via the service-role client — freshly minted codes
render with a one-click copy of the full `/invite?code=...` link. Prefer
the UI day-to-day; the CLI (§2) still works identically and is the only
option if you'd rather not sign in as an admin (e.g. scripting a bulk
mint).

**Users card has a per-row "Run hunt" button (HNT-1).** Dispatches
`hosted-hunt.yml --user <uuid>` for that one row via the same
`POST /api/hunt/run` route the feed's own button uses, with the admin
cooldown bypass applied. See §7 for the full user-triggered-hunts model.

---

## 7. User-triggered hunts (HNT-1)

Scoring stopped being automatic-for-everyone. `hosted-hunt.yml`'s daily
cron now runs **discovery only** (`jobify-hosted-hunt --discovery-only`)
— free, keeps the shared `postings` pool fresh, zero LLM spend. Each user
scores on demand instead, via a "Run my hunt" button on their own feed
(and an equivalent per-row button in the admin Users card, §6).

**How a click becomes a scored feed:**

1. Feed button → `POST /api/hunt/run` (optionally `{ userId }`, honored
   only for admins).
2. The route gates (signed in → invite-or-admin → target user's profile
   exists and isn't `invalid`), then checks the cooldown (skipped for
   admins), then calls the GitHub Actions REST API:
   `POST /repos/${GITHUB_REPO}/actions/workflows/hosted-hunt.yml/dispatches`
   with `{ ref: "main", inputs: { user_id } }`, authenticated as
   `GITHUB_DISPATCH_TOKEN`.
3. On a `204` the route stamps `profiles.last_hunt_requested_at` (service
   role) and returns `{ ok: true, cooldown_until }`.
4. GitHub Actions runs `jobify-hosted-hunt --user <uuid>` — discovery
   (free, keeps the pool fresh) then fan-out for that one user only
   (`jobify.hosted.fanout.run_fanout_cycle(user_ids=[uuid])`).
5. The feed page polls (`router.refresh()` every 20s for 5 minutes) so
   new matches show up without a manual reload.

**Cooldown.** `HUNT_COOLDOWN_HOURS` (default `6`) gates how often a
non-admin can trigger their own hunt — a 429 with `cooldown_until` is
returned while still in the window. Admins bypass it entirely, for both
their own hunt and any row's button in the admin panel.

**Known limitation, accepted for invite-only beta (see
`0007_hunt_cooldown.sql`'s header):** the existing `profiles_update_own`
RLS policy already lets an authenticated user UPDATE their own
`profiles` row for any column, including `last_hunt_requested_at`. A
malicious user could null or backdate it via a raw authed UPDATE to
bypass their own cooldown — but that only lets them spend their own pool
budget faster, not anyone else's. The real fix (column-level privileges,
or moving cooldown state to a separate service-role-only table) is
parked, not implemented.

**Manual/ad-hoc runs.** A `workflow_dispatch` with no `user_id` input
(`gh workflow run hosted-hunt.yml`) still runs the original
discovery-then-fan-out-everyone cycle, unchanged — useful for an
operator who wants to force a full re-score outside the per-user trigger
path.

---

## 8. System screen — what the numbers mean

The `/admin/system` page (second tab next to "Operations") presents a
static "How it works" explainer (top) and five live performance panels
(bottom) backed by the `hunt_cycles` table.

**Important:** `hunt_cycles` only has rows starting from this feature
(wave 8) onward. Any cycle that ran before migration `0008_hunt_cycles.sql`
was applied has no corresponding row. Immediately after this ships, the
"Recent cycles" table and funnel will look sparse or empty — this is
expected, not a bug. The panels populate over subsequent cycles.

The five performance panels:

- **Recent cycles** — one row per worker cycle (`hunt_cycles` table): cycle
  start, trigger (`cron` or `user`), postings scored / matched / skipped,
  pool spend, and any error.
- **Ladder funnel** — from the most recent scoring cycle's stage counters:
  how many candidates moved through stages 1 (rubric) → 2 (embeddings) →
  3 (rerank) → 4 (verdict). See [`docs/SCORING.md`](SCORING.md) for the
  scoring stages.
- **Cost breakdown** — month-to-date pool spend vs cap, split by event
  type (rubric, embedding, rerank, verdict) and model (Claude vs Voyage).
  See [`docs/COST_RAILS.md`](COST_RAILS.md) for cost mechanics.
- **Engagement** — matches by state (saved/applied/dismissed) and the
  save:dismiss ratio, plus per-user applied match counts.
- **Pool freshness** — current postings volume in the shared pool and
  staleness (how many days old the oldest row is).

For the scoring mechanics and cost-estimation formulas that underpin
these numbers, see [`docs/SCORING.md`](SCORING.md) and
[`docs/COST_RAILS.md`](COST_RAILS.md).
