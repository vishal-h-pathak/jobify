# COST_RAILS — hard caps, global pool, BYO keys

H6 of the hosted plan (`planning/HOSTED_AGGREGATOR_PLAN.md` §4,
`planning/session-prompts/15_h6_cost_rails.md`). This is the launch
blocker: no invites go out until it merges. `jobify/hosted/fanout.py`'s
scoring ladder (see `docs/SCORING.md`) is where every LLM call this
document governs actually happens.

## The three budget layers

```
1. Per-user pool cap    budget_caps.monthly_usd_cap (default $5/user/month)
                        get_budget_cap / get_month_to_date_spend
2. Global pool cap      HOSTED_GLOBAL_MONTHLY_CAP_USD (default $100 total)
                        get_global_month_to_date_spend
3. BYO key bypass       api_keys row -> user's own decrypted Anthropic key
                        bypasses BOTH caps entirely (still logged)
```

All three read/write `budget_ledger` (`0002_multitenant.sql` +
`0006_cost_rails.sql`'s new `byo` column). A row with `byo = TRUE` is
spend on the user's OWN key — it's still recorded (useful for the
settings page's own-spend display) but is EXCLUDED from both
`get_month_to_date_spend` and `get_global_month_to_date_spend`. That's
the whole mechanism: pool accounting simply never sees BYO rows.

### 1. Per-user pool cap — hard, mid-batch

Pre-H6, stage 4's budget check ran once per user per cycle, before the
top-N loop — a user sitting just under cap could still burn up to
`HOSTED_STAGE4_TOP_N` more verdicts before the NEXT cycle's check caught
up. H6 makes it a hard cap: `_run_user_ladder`'s stage-4 loop re-checks
`get_month_to_date_spend` vs `get_budget_cap` every
`HOSTED_BUDGET_RECHECK_EVERY` verdicts (default 5, env-tunable) — not
just once per batch. Crossing the cap mid-batch stops that user's stage
4 for the rest of the cycle; stages 1-3 (title filter, rubric score,
embedding rerank) already ran and their matches stand.

### 2. Global pool cap — the "$100 total" promise

`HOSTED_GLOBAL_MONTHLY_CAP_USD` (default 100, env-tunable) bounds total
non-BYO spend across every user this month, including the `user_id IS
NULL` global-embedding rows (`get_global_month_to_date_spend`). It's
checked twice, deliberately at different granularities:

- **Once at cycle start** (`run_fanout_cycle`) — snapshotted and passed
  to every user's ladder. Gates whether a user with NO cached rubric yet
  may spend the one-time compile call this cycle (`allow_new_compile`).
  An already-compiled rubric is always reused regardless — re-scoring
  with a cached rubric costs zero tokens.
- **Freshly, at each per-user mid-batch recheck inside stage 4** — not
  the cycle-start snapshot. This matters: if user A's spend crosses the
  global cap partway through the cycle, a LATER user B's stage-4 loop
  must see that on its own next recheck, not just at B's own cycle-start
  snapshot (which was taken before A's spend landed). A live re-read at
  the same cadence as the per-user recheck closes that gap without an
  extra query on every single verdict.

Exceeded => that cycle's stage-2 compiles and stage-4 verdicts are
skipped for every pool user. The feed keeps working — stages 1-3 for
users with an existing rubric are untouched; a user with no rubric yet
just waits for a future (under-cap) cycle. BYO users are entirely
unaffected either way.

### 3. BYO keys — bypass, not a bigger cap

A user with an `api_keys` row runs their rubric compile AND stage-4
verdicts on their OWN decrypted Anthropic key instead of the pool's.
Both caps above are skipped entirely for that call — `_resolve_byo_key`
resolves the key once per ladder run (fresh DB read + decrypt, never
cached across users, same discipline `jobify.profile_loader` uses for
profile state) and every downstream call conditionally takes an
`api_key` override:

- `jobify.shared.llm.complete_with_usage(..., api_key=...)` — when
  supplied, routes through a fresh per-call `anthropic.Anthropic` client
  instead of the pool's env-based key, and skips the cool-off/OAuth
  fallback chain entirely. A BYO key's own failure (invalid, out of
  credits) surfaces to the caller rather than silently falling back to
  spend the shared pool's credits under a `byo=True` row — that would
  hide the real cost.
- Every ledger row from a BYO call is written with `byo=True`.

A decryption failure (`jobify.hosted.keycrypt.KeyDecryptionError` —
wrong/rotated secret, corrupted row) is logged and degrades that user to
the pool-with-caps path for the cycle; it never crashes the cycle.

## BYO key encryption

AES-256-GCM, identical wire format in both runtimes:

```
v1:<base64 nonce>:<base64 ciphertext+tag>
```

- 12-byte random nonce per encryption.
- The GCM auth tag is appended to the ciphertext
  (`Buffer.concat([encrypted, authTag])` on the encrypt side) rather than
  carried as a separate field — Python's
  `cryptography.hazmat.primitives.ciphers.aead.AESGCM` expects/produces
  that exact concatenated shape, so neither side needs extra framing.
- **Encrypt** (`web/lib/crypto/keys.ts`, `node:crypto`) — only ever runs
  server-side, inside `POST /api/keys`. The plaintext key never lands in
  a log, the DB, or a response body; the route returns only `...last4`.
- **Decrypt** (`jobify/hosted/keycrypt.py`, `cryptography`'s `AESGCM`) —
  only the hosted worker (`jobify.hosted.fanout`) ever decrypts, and only
  in memory for the duration of one LLM call.
- Cross-runtime fixture: `tests/test_keycrypt.py`'s
  `test_cross_runtime_fixture_decrypts` hardcodes a real blob produced by
  the TS implementation and asserts the Python side decrypts it — proof
  the two independent implementations actually agree on the wire format,
  without needing node installed at Python test time.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `HOSTED_BUDGET_RECHECK_EVERY` | `5` | Stage-4 mid-batch per-user cap recheck interval (verdicts) |
| `HOSTED_GLOBAL_MONTHLY_CAP_USD` | `100` | Total non-BYO spend cap across every user this month |
| `JOBIFY_KEY_ENCRYPTION_SECRET` | _(none — required for BYO keys)_ | Base64-encoded 32-byte AES-256-GCM secret, shared by both runtimes |

`budget_caps.monthly_usd_cap` (per-user, DB-side default $5.00) is set
out of band — service-role/admin only, per `0002_multitenant.sql`'s RLS
contract (a user can SELECT their own cap, never raise it themselves).

## Rotating `JOBIFY_KEY_ENCRYPTION_SECRET`

**Invalidate, don't re-encrypt.** Rotating the secret makes every
existing `api_keys.encrypted_key` ciphertext permanently undecryptable —
that's intentional, not a bug to work around. The alternative (decrypt
every row under the old secret, re-encrypt under the new one, in one
migration step) needs the OLD secret held alongside the new one during
the rotation window and a bespoke one-off script; invalidate needs
neither.

The failure path already exists and is exercised in
`tests/test_hosted_fanout.py::test_byo_key_decrypt_failure_falls_back_to_pool_with_caps`:
a `KeyDecryptionError` degrades that user to pool-with-caps for the
cycle rather than crashing it. So after a rotation:

1. Every user with a BYO key on file silently falls back to the shared
   pool (subject to both caps above) starting the worker's next cycle.
2. Nothing crashes, nothing needs a backfill script.
3. Affected users re-paste their key on the settings page — a fresh
   `POST /api/keys` call encrypts under the new secret.

Communicate the rotation to BYO users out of band (their pool spend
resumes counting against the shared cap until they re-paste) — the
worker itself has no way to notify them proactively.
