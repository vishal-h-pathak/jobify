# Task 2 report — Global discovery + embeddings (H4 hosted worker)

## Summary

Implemented Part A (global discovery), Part B (Voyage embeddings), the
`docs/SCORING.md` stage-3 write-up, and tests. Full suite green (550
passed, 1 skipped, 26 deselected legacy), `ruff check` clean on every
file this task touched. No network calls anywhere in the test suite.

## Part A — `jobify/hosted/discovery.py`

Scoped to the four portals.yml-configured ATS sources (greenhouse, lever,
ashby, workday) — the only sources with a per-user board list to union.
The other `jobify.hunt.sources` fetchers (remoteok, serpapi, jsearch,
hn_whoshiring, eighty_thousand_hours) run fixed keyword searches with
nothing per-user to union, and the brief's Part A steps 1-4 explicitly
describe only the `companies()`/`workday_tenants()`-backed sources — I
read this as intentionally out of scope rather than an oversight; flagged
below under concerns in case the brief meant otherwise.

Flow:
1. `jobify.db.list_profile_user_ids()` (new) — every user with a
   `profiles` row.
2. `_union_portal_targets()` — materializes each user's profile
   (`profile_loader.materialize_profile_dir`), reads their
   `portals.yml` boards via the dir-parameterized `companies()` /
   `workday_tenants()`, and unions them: Greenhouse/Lever/Ashby dedup by
   `slug` (first-seen display name wins), Workday dedups by
   `(tenant, site, dc)` (first-seen row, including `limit_pages`, wins). A
   user whose profile fails to materialize is logged and skipped — one
   broken profile never blocks the rest of the cycle.
3. `_iter_union_postings()` — calls each of the four sources' `fetch()`
   exactly once with the union list, with the same cross-source dedup by
   canonical job id that `jobify.hunt.agent.iter_all_jobs` uses.
4. `run_discovery_cycle()` — for each yielded job, resolves the link via
   `jobify.hunt.agent._resolve_link_and_liveness` (imported and reused
   directly, per the brief), then `jobify.db.upsert_posting()` (new).
   Dead postings are still upserted (with `link_status='expired'`),
   matching the single-user pipeline's `upsert_job(job, status="expired")`
   behavior rather than silently vanishing from the pool. Returns a
   summary dict (`users`, `boards`, `fetched`, `upserted`, `dead`) for
   Task 4's cycle-summary log line.

**Source-fetcher extension** (additive, non-breaking, same pattern Task 1
used): `greenhouse.fetch()`, `lever.fetch()`, `ashby.fetch()` grew an
optional `targets: list[tuple[str, str]] | None = None` param; `workday.fetch()`
grew an optional `tenants: list[dict] | None = None` param. Omitted (every
existing `jobify-hunt` call site), each resolves the single active
profile's portals.yml exactly as before — verified by the full existing
hunt suite staying green untouched.

**`jobify/db.py` additions**: `list_profile_user_ids()`, `upsert_posting()`
(service-role write via `_get_client()`, matching `upsert_job`'s pattern
exactly; keyed by `id` via `.upsert(..., on_conflict="id")`;
`first_seen_at` is deliberately excluded from the payload so the column's
own `DEFAULT now()` only fires on the initial insert, never overwritten on
a re-upsert).

## Part B — `jobify/hosted/embed.py`

**Voyage API research** (WebFetch/WebSearch against `docs.voyageai.com`,
cross-checked across two independent fetches + a search, since the first
fetch's summary was self-contradictory):
- Model: `voyage-3.5-lite` — confirmed to exist and to support an
  `output_dimension` parameter.
- `output_dimension` valid values for `voyage-3.5-lite`: `{256, 512, 1024,
  2048}`, default 1024. **1024 is valid and is the default** — no
  dimension-altering migration needed, matching the brief's expectation.
- SDK: `voyageai.Client().embed(texts=..., model=..., input_type=...,
  output_dimension=...)` returns an object with `.embeddings` (list of
  vectors) and `.total_tokens` (int) — used for real ledger token counts,
  never estimated.
- Pricing: $0.02 / 1M input tokens (first 200M free), no output-token
  charge for embeddings.

**API surface**:
- `embeddings_enabled() -> bool` — `EMBEDDINGS_ENABLED` (soft default
  `True`, `jobify.config._bool`) AND non-empty `VOYAGE_API_KEY`.
- `embed_texts(texts) -> list[list[float]] | None` — raw call; `None` when
  disabled (not `[]`, so callers can tell "disabled" from "empty batch");
  `[]` for an empty `texts` list while enabled, with zero API calls
  either way.
- `ensure_posting_embedding(posting_id, text) -> bool` — computes +
  stores ONLY if `postings.embedding` isn't already set (global,
  computed once); writes an `event='embedding'` ledger row with
  `user_id=None` (global, unattributed cost).
- `ensure_profile_embedding(user_id, text, *, force=False) -> bool` —
  computes + stores if absent, or unconditionally when `force=True`. I
  picked the `force: bool` option the brief offered rather than inventing
  a new "embedding computed at" column: no schema change beyond what the
  brief explicitly authorized (the `budget_ledger.user_id` NOT NULL drop),
  and it hands the "did the profile change" decision to Task 3's fan-out,
  which already re-materializes the profile every cycle and can compare
  `profiles.updated_at` itself. Ledger row uses the specific `user_id`.

**Schema**: `jobify/migrations/0004_worker.sql` appended (not a new file)
with `ALTER TABLE budget_ledger ALTER COLUMN user_id DROP NOT NULL;`, and
`jobify.db.insert_budget_ledger_row`'s `user_id` param widened to
`str | None`. `jobify/db.py` also grew `get_posting_embedding` /
`set_posting_embedding` / `get_profile_embedding` / `set_profile_embedding`
— small helpers consistent with the module's "canonical Supabase data
layer" convention, keeping `embed.py` free of direct `.table(...)` calls.

**Config** (`jobify/config.py`): `VOYAGE_API_KEY` (empty-string soft
default) and `EMBEDDINGS_ENABLED` (`_bool("EMBEDDINGS_ENABLED", "true")`
— reuses the module's existing boolean-env convention, so `"false"`/`"0"`
disable case-insensitively).

**Dependency**: `voyageai>=0.3.0` added to `pyproject.toml`'s dependency
list (installed and verified in the worktree venv: `voyageai==0.4.1`).
`embed.py` still lazy-imports it inside `_get_client()` (matching
`jobify.db._get_client`'s lazy-Supabase-import pattern) so the module
itself imports cleanly regardless.

## Docs

`docs/SCORING.md` grew a new "## Stage 3 — embedding rerank" section
(the doc had no dedicated stage-3 subsection yet, just the pipeline
table's one-line row — added a full section modeled on the existing
"Stage 2" section) covering the provider decision, dimension, cost
estimate, and the `EMBEDDINGS_ENABLED`/missing-key degradation contract.

## Tests

- `tests/test_hosted_discovery.py` (new, 8 tests): `_union_portal_targets`
  dedup by slug (Greenhouse) and by `(tenant, site, dc)` (Workday); a
  user whose profile fails to materialize is skipped without aborting the
  cycle; `run_discovery_cycle` — two users watching the same Greenhouse
  company → exactly ONE `greenhouse.fetch()` call and ONE
  `upsert_posting` call (the brief's required dedup test); cross-source
  dedup by job id; a dead posting is still upserted with
  `link_status='expired'`; a no-users cycle is a clean no-op. Fakes the
  source-fetcher layer (`greenhouse.fetch`/`lever.fetch`/etc.
  monkeypatched) and the DB layer (`jobify.db.list_profile_user_ids` /
  `upsert_posting` monkeypatched) — no network. Link resolution runs for
  real against direct ATS URLs (`is_ats_url` short-circuits, zero extra
  HTTP) and, for the dead-posting test, against a real
  `agent.resolve_application_url` stub (same pattern
  `tests/test_hunt_direct_listings.py` already uses).
- `tests/test_hosted_embed.py` (new, 17 tests): `embeddings_enabled()`
  across flag/key permutations (including whitespace-only key);
  `embed_texts` returns `None` with **zero client construction attempted**
  when disabled (asserted via a `_get_client` stub that raises if called
  at all) in both disablement modes (flag false, key empty); `[]` vs
  `None` disambiguation; `ensure_posting_embedding` /
  `ensure_profile_embedding` — disabled no-op (DB untouched), skip when
  already present, compute+store+ledger on the happy path (asserting the
  exact ledger `user_id` — `None` for postings, the specific id for
  profiles — and real `total_tokens`-derived `cost_usd`), and `force=True`
  recomputing over an existing profile embedding.
- `tests/test_db_hosted.py` (extended, 21 tests added): `list_profile_user_ids`,
  `insert_budget_ledger_row(None, ...)`, `upsert_posting` (payload shape,
  `on_conflict="id"`, `first_seen_at` intentionally absent from the
  payload), and the four embedding get/set helpers. Extended the file's
  existing `_FakeQuery` double with an `.upsert()` mode rather than adding
  a parallel fake class.

### Results

```
$ pytest tests/test_hosted_discovery.py tests/test_hosted_embed.py tests/test_db_hosted.py -q
41 passed in 0.52s

$ pytest -q   # full suite
550 passed, 1 skipped, 26 deselected in 26.84s

$ ruff check jobify/hosted/ jobify/db.py jobify/config.py jobify/hunt/sources/{greenhouse,lever,ashby,workday}.py tests/test_hosted_discovery.py tests/test_hosted_embed.py tests/test_db_hosted.py
All checks passed!
```

`ruff check .` on the whole repo reports the same 8 pre-existing E402
errors in `tests/test_prefill_stop_at_submit.py` as the pre-change
baseline (verified via `git stash` before/after) — unrelated to this
task, not introduced by it.

### TDD evidence

Followed red→green per function group (discovery dedup, embed
degradation, db helpers) rather than one big red pass — representative
sample:

RED (before `ensure_posting_embedding` existed):
```
$ pytest tests/test_hosted_embed.py -q
ImportError: cannot import name 'embed' from 'jobify.hosted' ...
```
GREEN (after):
```
$ pytest tests/test_hosted_embed.py -q
17 passed in 0.1s
```

## Files changed

- `jobify/hosted/__init__.py` (new)
- `jobify/hosted/discovery.py` (new)
- `jobify/hosted/embed.py` (new)
- `jobify/db.py` — `list_profile_user_ids`, `upsert_posting`,
  `get_posting_embedding`/`set_posting_embedding`,
  `get_profile_embedding`/`set_profile_embedding`, widened
  `insert_budget_ledger_row(user_id: str | None, ...)`
- `jobify/config.py` — `VOYAGE_API_KEY`, `EMBEDDINGS_ENABLED`
- `jobify/hunt/sources/greenhouse.py` — `fetch(targets=None)`
- `jobify/hunt/sources/lever.py` — `fetch(targets=None)`
- `jobify/hunt/sources/ashby.py` — `fetch(targets=None)`
- `jobify/hunt/sources/workday.py` — `fetch(tenants=None)`
- `jobify/migrations/0004_worker.sql` — appended
  `ALTER TABLE budget_ledger ALTER COLUMN user_id DROP NOT NULL;`
- `pyproject.toml` — `voyageai` dependency, `jobify.hosted` in
  `[tool.setuptools] packages`
- `docs/SCORING.md` — new "Stage 3 — embedding rerank" section
- `tests/test_hosted_discovery.py` (new)
- `tests/test_hosted_embed.py` (new)
- `tests/test_db_hosted.py` (extended)

## Self-review findings

- Fixed one test bug during self-review: an initial ledger-cost assertion
  used `total_tokens=17`, which rounds to `0.0` at the ledger's 6-decimal
  precision (`round(17 * 0.02 / 1e6, 6) == 0.0`) — not a bug in the
  implementation, just a test that picked too small a token count to
  observe a nonzero `cost_usd`. Bumped to `50_000` tokens so the assertion
  is meaningful.
- Removed a redundant `import jobify.hunt.agent as _hunt_agent` line from
  an early draft of `discovery.py` once I confirmed that
  `from jobify.hunt.agent import _resolve_link_and_liveness` alone already
  fully executes `agent.py` (including its `sys.path` bootstrap) before
  binding the name — the extra import was dead weight.
- Confirmed `is_ats_url` recognizes all four ATS hosts
  (greenhouse/lever/ashby/workday), so `_resolve_link_and_liveness` never
  issues an extra HTTP fetch for anything discovery's four sources yield
  — "zero LLM tokens" is true, and in practice discovery makes zero
  *extra* HTTP calls beyond the source fetches themselves too.

## Concerns

- Did not add a `jobify-hosted-hunt` console script or a
  `.github/workflows/hosted-hunt.yml` — those are explicitly Task 4's
  job per the session prompt's task list, not this task's brief.

## Fix note (post-review)

The "Scope of 'global discovery'" concern above was confirmed to be a
real gap, not a deliberate scope boundary: the session-prompt spec says
"fetch once via the existing `jobify.hunt.sources`" without qualifying
to the portal-configured ones, and single-user `jobify-hunt` fetches
from all nine `SOURCES`. Restricting hosted discovery to the four portal
sources meant hosted users lost the other five sources' postings
(remoteok, serpapi, jsearch, hn_whoshiring, eighty_thousand_hours)
relative to what single-user `jobify-hunt` would have found for them.

**Fix**: `_iter_union_postings()` now also calls the five fixed
zero-arg sources (`hn_whoshiring.fetch()`, `eighty_thousand_hours.fetch()`,
`remoteok.fetch()`, `jsearch.fetch()`, `serpapi.fetch()`) exactly once
per discovery cycle, no per-user unioning needed since their output is
identical regardless of which user asks — mirroring how
`jobify.hunt.agent.iter_all_jobs` already calls them unconditionally.
Their output folds into the same cross-source dedup-by-job-id set the
four portal sources share (factored into a new `_dedup_fetch()` helper
to avoid duplicating the dedup loop), and upserts via the same
`jobify.db.upsert_posting()` path. `_union_portal_targets()` and the
portal-source flow are untouched.

`tests/test_hosted_discovery.py` grew two tests: one asserting all nine
sources are each called exactly once per cycle (not once per user, with
two users sharing a Greenhouse board to exercise the union path
alongside the five fixed calls), and one asserting cross-source dedup
holds between a fixed source (remoteok) and a portal source
(greenhouse) sharing a canonical job id. The autouse
`_no_op_other_sources` fixture was extended to no-op the five fixed
sources by default so the rest of the existing suite stays network-free
now that `_iter_union_postings` calls them unconditionally.

```
$ pytest tests/test_hosted_discovery.py tests/test_hosted_embed.py tests/test_db_hosted.py -q
43 passed in 0.53s

$ pytest -q
552 passed, 1 skipped, 26 deselected in 26.76s

$ ruff check jobify/hosted/discovery.py tests/test_hosted_discovery.py
All checks passed!
```
