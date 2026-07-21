# Session 54 — HUNT2-S6: board health, telemetry, fixups  (worktree `feat/hunt2-s6`)

**Model: Sonnet.** Spec: `planning/HUNT2_SOURCES.md` §5 (P3), plus the
fixup list accumulated across waves A/B (each pinned below). This is the
layer that keeps a 190+-board catalog from rotting silently.

## Constitutional rules
1. Scrub gate PASS; Alex Quinn fixtures. 2. You own migration
`jobify/migrations/0018_board_health.sql` (committed, never applied;
session 53, parallel, owns none — but do not touch its files). 3. Zero
LLM. 4. Commit on `feat/hunt2-s6`; no push, no merge.

## Collision avoidance (session 53 runs in parallel)
YOURS: `jobify/hosted/discovery.py`, `jobify/hosted/worker.py`,
`jobify/hosted/candidates.py`, new `jobify/hosted/board_health.py`,
migration 0018, `web/lib/portals/tierPacks.ts` +
`web/lib/profile/portalsSeed.ts` (Workday gap), `web/lib/admin/**` +
admin pages (health/telemetry cards), repo `conftest.py`.
NOT YOURS: `jobify/hunt/sources/query_templates.py`, `query_gen.py`
(53 is creating it), `jobify/shared/llm.py`, jsearch/serpapi internals.

## The work (cut from the bottom if scope bites — never items 1-3)
1. **0018 + board_health**: table `board_health(board_id uuid references
   board_catalog, day date, http_status int, posting_count int,
   name_check_ok boolean, primary key (board_id, day))` + a
   `board_catalog.status` value `'dormant'` allowed. Discovery records a
   row per catalog-known board per run; the impostor name-check runs on
   EVERY poll (Greenhouse metadata endpoint / Ashby organizationName;
   Lever exempt — no metadata, record null).
2. **Alerts + propose-only relocation**: after recording, evaluate: HTTP
   404/410, posting_count 0 against a nonzero 90-day baseline, or
   name_check false → mark board `status='dead'` (new allowed value),
   loudly counted in the run summary, and enqueue a relocation candidate
   (`evidence_kind='relocation'`, the queue + probe from S4) proposing a
   new home if the probe finds one. NEVER auto-swap — admin approves.
3. **Funnel rollups + kill rules**: SQL view(s) (in 0018) rolling up per
   source / per board / per paid query (query string from
   `postings.raw->>'_jobify_query'`): postings contributed, matches
   surfaced, users engaged (matches.state in seen/saved/applied), over
   60/90-day windows. Admin "Sources" card renders the rollup with flags: paid query
   zero-surfaced-60d → `rotate`; board zero-surfaced-90d → `dormant`
   candidate (flag only; admin button sets dormant; dormant boards are
   excluded from tier packs but still cheap-fetched).
4. **Workday tier-pack gap** (S3 flag): extend `SlugProbeAts`/types +
   portalsSeed so catalog `workday` rows (slug encodes tenant/dc/site —
   split on "/") seed into a user's portals `workday:` section (schema
   already supports it). Tier packs may now include Workday boards.
5. **Aggregator feeder cursor** (S4 flag): replace the stateless
   full-table scan with a cycle cursor (max created_at seen, stored in a
   tiny state row — fold into 0018) so repeat scans are incremental.
6. **Test isolation guard** (live incident: synthetic hunt_cycles rows
   48-50 reached the PRODUCTION database during a local pytest run with
   service credentials exported): repo `conftest.py` refuses to run any
   test that would construct a real Supabase client against a non-local
   URL unless `JOBIFY_TEST_ALLOW_LIVE=1` is explicitly set — fail the
   test session with a clear message instead. Verify the offending
   test(s) (whichever wrote those rows) are properly mocked.
7. **Auto-tag approved boards** (S4 flag): persist a compact
   `top_title_terms` list in candidate probe_result (currently stripped)
   so approve-time auto-tagging has material; approved boards get
   heuristic tags instead of none.

## Verification
`.venv/bin/pytest`; `cd web && npx tsc --noEmit && npx vitest run && npm
run build`; scrub. Aim ≤~700 lines. 0018 DDL verbatim in the report.

## Report format
Per-item status/files/tests; 0018 DDL; which test wrote the live rows
(item 6 finding); judgment calls. Do not begin until the owner confirms.
