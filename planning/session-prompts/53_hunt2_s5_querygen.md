# Session 53 — HUNT2-S5: per-user query generation  (worktree `feat/hunt2-s5`)

**Model: Sonnet.** Spec: `planning/HUNT2_SOURCES.md` §4.3 — the permanent
fix for fossilized paid-search queries. Wave A's interim templates
(`jobify/hunt/sources/query_templates.py`, P0.6) stay as the FALLBACK;
this session adds rubric-derived, LLM-generated queries as the primary.

## Constitutional rules
1. Scrub gate PASS; Alex Quinn fixtures.
2. NO migrations (session 54, parallel, owns 0018 — do not create one).
   Store generated queries in the profile doc as a new key
   (`"search_queries.json"`) — unknown doc keys are ignored by validation
   (established pattern: `portals.couldnt_auto_find.json`).
3. THE ONE NEW LLM CALL is metered: every generation writes a
   budget_ledger row with event `query_gen` via the existing ledger path.
   Bound: one small call per user per ~30 days (or when the compiled
   rubric changes), target ≤$0.01/user/month. Discovery remains zero-LLM
   at run time — it only ever READS stored queries.
4. Commit on `feat/hunt2-s5`; no push, no merge.

## Collision avoidance (session 54 runs in parallel)
YOURS: `jobify/hunt/sources/query_templates.py` (extend), new
`jobify/hunt/sources/query_gen.py`, `jobify/shared/llm.py` (only if a new
helper is genuinely needed), jsearch/serpapi fetchers ONLY if their query
consumption needs a signature tweak, profile-doc read/write helpers, tests.
NOT YOURS: `jobify/hosted/discovery.py`, `jobify/hosted/worker.py`,
`jobify/hosted/candidates.py`, `jobify/hosted/fanout.py`, anything under
`web/`, migration 0018. HARD CONSTRAINT: discovery.py already calls into
query_templates for the per-user union (P0.6) — your changes live BEHIND
that existing call surface so discovery.py needs zero edits. If you
believe you must touch it, STOP and flag.

## The work
1. **`query_gen.py`**: `ensure_user_queries(user_id, profile_dir, ...)` —
   if the profile doc has fresh `search_queries.json` (generated_at within
   30 days AND rubric fingerprint unchanged), return stored. Otherwise one
   LLM call (via `jobify.shared.llm`, so the API-key-preferred /
   OAuth-fallback transport and ledger conventions apply) generating ≤10
   paid-search queries from the COMPILED RUBRIC (not raw profile): title
   synonyms × seniority variants × (remote / preferred metro). Structured
   output, validated; on any failure fall back to the P0.6 templates and
   store nothing (never cache a failure). Store: queries + generated_at +
   rubric fingerprint (hash of compiled rubric).
2. **Wire behind query_templates**: `build_queries_for_profile` (or its
   caller inside the same module) prefers stored generated queries, falls
   back to templates. Cross-user dedup + the 12/provider/run cap are
   UNCHANGED and still apply after substitution.
3. **Provenance**: each paid-search posting's `raw` jsonb gains the query
   string that found it (`{"_jobify_query": "..."}` merged into raw at
   fetch time — jsearch/serpapi only). Zero schema change; S6's rollups
   read it.
4. **Rails**: generation call max_tokens small (≤1024), forced structured
   output per house transport rules; a cost guard skips generation and
   falls back if the ledger shows a `query_gen` row for this user in the
   last 24h (runaway protection).

## Verification
`.venv/bin/pytest`; scrub. Tests: freshness/fingerprint logic, fallback on
LLM failure, never-cache-failure, cap+dedup unchanged, provenance merge,
24h guard. Aim ≤~450 lines.

## Report format
Status/files/tests; the exact generation prompt; storage shape verbatim;
cost per generation observed in any live test (only if
CLAUDE_CODE_OAUTH_TOKEN present — otherwise mocked only, say so). Do not
begin until the owner confirms.
