# Session 15 — H6: Cost rails — hard caps, global pool, BYO keys  (Hosted wave 3)

**Run from:** a `jobify-wt/hosted-h6-cost-rails` worktree.
**Depends on:** waves 1–2 merged to main (H1–H4) + migration 0005.
**Parallel-safe with:** H5 (14). File boundaries this wave:
- **You own:** `jobify/hosted/**`, `jobify/db.py`, `jobify/shared/llm.py`, `jobify/config.py`, `jobify/migrations/0006_cost_rails.sql` (new), `web/app/(app)/settings/**` (new), `web/app/api/keys/**` (new), `web/lib/crypto/**` (new), `web/lib/db/keys.ts` (new), their tests, `docs/`.
- **Do NOT touch:** `web/app/(app)/feed/**`, `web/app/(app)/layout.tsx`, `web/lib/db/matches.ts`, `dashboard/`, `jobify/tailor/`, `jobify/submit/`, migrations 0001–0005.
- `web/lib/supabase/types.ts` is SHARED-RISK: if you must extend it (new
  columns), append only — H5 doesn't touch it this wave, but keep the diff
  minimal and additive.

---

## Context

Read `planning/HOSTED_AGGREGATOR_PLAN.md` §4 and the wave-2 code:
`jobify/hosted/fanout.py` (stage-4 budget check — soft, once-per-batch),
`jobify/db.py` (`get_month_to_date_spend`, `get_budget_cap`,
`insert_budget_ledger_row`), `jobify/shared/llm.py` (the completion
chokepoint that records usage). H3's onboarding also writes ledger rows per
turn. **This phase is the launch blocker: no invites go out until it merges.**
Live project: `vujlecpmurismvnjebcf`.

## Tasks

1. **Migration `0006_cost_rails.sql`** (additive, idempotent, conventions of
   0002–0005; pin TYPES exactly — wave-2 lesson):
   - `api_keys`: `ADD COLUMN IF NOT EXISTS key_last4 TEXT;` (safe UI display)
     and `ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`
   - `budget_ledger`: `ADD COLUMN IF NOT EXISTS byo BOOLEAN NOT NULL DEFAULT FALSE;`
     (spend on the user's own key — excluded from pool accounting).
   - `api_keys` needs a DELETE policy (own-row) so users can remove their key
     — 0002 deliberately had none; add it here with a header note.
2. **Hard per-user enforcement** (`jobify/hosted/fanout.py`) — upgrade the
   stage-4 check from once-per-batch to **re-check every K verdicts**
   (`HOSTED_BUDGET_RECHECK_EVERY`, default 5) against pool spend
   (`byo = FALSE` rows only). Over cap mid-batch → stop stage 4 for that
   user, log, increment the existing counter.
3. **Global pool cap** — `HOSTED_GLOBAL_MONTHLY_CAP_USD` (default 100): total
   non-BYO spend across ALL users this month (include the `user_id IS NULL`
   global-embedding rows). Checked at cycle start AND alongside the per-user
   re-check; exceeded → the entire cycle degrades to stages 1–3 (feed still
   updates, no LLM verdicts, no compile). This is the "$100 total" promise.
4. **BYO keys, end to end:**
   - **Crypto:** AES-256-GCM with a 32-byte secret from
     `JOBIFY_KEY_ENCRYPTION_SECRET` (base64). Implement in BOTH runtimes with
     an identical wire format `v1:<b64 nonce>:<b64 ciphertext+tag>`:
     `web/lib/crypto/keys.ts` (node:crypto, encrypt side) and
     `jobify/hosted/keycrypt.py` (`cryptography` lib, decrypt side). Add a
     cross-runtime fixture: a TS-encrypted blob checked into the Python tests
     that must decrypt correctly.
   - **Settings page** (`web/app/(app)/settings/`): show month-to-date pool
     spend vs cap (authed reads of own ledger/cap rows); paste an Anthropic
     key → server route (`web/app/api/keys/`) validates shape (`sk-ant-…`),
     encrypts, upserts `api_keys` with `key_last4`; delete key. **The
     plaintext key never lands in a log, the DB, or a response body**; after
     save, the UI shows only `…last4`. Both routes enforce the invite gate
     server-side (H3 review lesson — layouts don't protect API routes).
   - **Worker routing** (`jobify/hosted/fanout.py` + `jobify/shared/llm.py`):
     when a user has an `api_keys` row, their rubric compiles + stage-4
     verdicts run on THEIR decrypted key (per-call client, never cached
     across users — same isolation discipline as the profile-loader fix),
     ledger rows get `byo = TRUE`, and BYO calls bypass per-user AND global
     pool caps (still recorded). Decryption failure → log, flag, fall back to
     pool-with-caps for that user (never crash the cycle).
5. **Tests** — fakes only: mid-batch stop at exactly the K-th recheck; global
   cap degrades cycle to stages 1–3; BYO user bypasses caps + rows flagged
   `byo`; two users one-BYO-one-pool in a single cycle use different keys
   (isolation regression, mirror the profile-loader test's approach); crypto
   roundtrip both runtimes + the cross-runtime fixture; settings routes 403
   without invite; plaintext never in any persisted payload (grep-style
   assertion on the fake DB writes).
6. **Docs** — `docs/COST_RAILS.md`: the three budget layers (per-user cap,
   global pool, BYO bypass), the env vars, the encryption format, and the
   operational runbook line for rotating `JOBIFY_KEY_ENCRYPTION_SECRET`
   (re-encrypt or invalidate: pick one, document it).

## Exit criteria

- Full Python suite green (no network); web vitest + `npx tsc --noEmit` green;
  `npm run build` clean.
- Cross-runtime crypto fixture passes in the Python suite.
- `git diff --stat`: nothing under `web/app/(app)/feed/`, `web/lib/db/matches.ts`,
  `web/app/(app)/layout.tsx`, `dashboard/`, `jobify/tailor/`, `jobify/submit/`.
- Commit: `H6: cost rails — mid-batch + global pool caps, BYO keys (AES-GCM, cross-runtime), settings UI`.
- Push the branch; do NOT merge — review-then-merge. Merge review will apply
  0006 to the live project and re-run the live RLS battery (incl. the new
  api_keys DELETE policy).
