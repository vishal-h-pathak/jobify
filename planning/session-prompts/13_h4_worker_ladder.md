# Session 13 — H4: Shared discovery worker + scoring ladder  (Hosted wave 2)

**Run from:** a `jobify-wt/feat/hosted-h4-worker` worktree.
**Depends on:** H1+H2 (merged to main).
**Parallel-safe with:** H3 (12) — you own `jobify/hosted/` (new), `jobify/hunt/`
additions, `jobify/profile_loader.py` (the parameterization fix below),
`jobify/migrations/0004_worker.sql` (only if needed), `.github/workflows/`.
Do NOT touch `web/`, `dashboard/`, or `0003_hosted_onboarding.sql` — H3 owns those.

---

## Context

Read `planning/HOSTED_AGGREGATOR_PLAN.md` §3–§4 and `docs/SCORING.md` (H2).
This session builds the hosted hunt: discovery runs ONCE globally into
`postings`, then scoring fans out per user via the ladder. New code lives in
`jobify/hosted/` (e.g. `worker.py`, `discovery.py`, `fanout.py`, `embed.py`);
reuse `jobify/hunt/` sources/pre-filter/link-resolution rather than forking
them.

## ⚠ Known gotcha you MUST fix first (from wave-1 review)

`profile_loader.profile_dir()` is `@lru_cache(maxsize=1)` and the DB backend
keys off the `JOBIFY_PROFILE_USER_ID` env var — **one process serves ONE
user**. Naively flipping the env var in-process will silently serve the first
user's profile to every user. Fix: add explicit parameterized entry points
(e.g. `load_profile(profile_dir: Path)` variants or a `ProfileHandle` object
wrapping a materialized dir) that bypass the process-global cache, keeping the
env-var path byte-compatible for the single-user CLI. Add a regression test:
two users materialized in one process get their OWN thesis text back.
Also: materialized-profile validation currently logs-not-raises — the worker
must instead write the Python validator's verdict to
`profiles.validation_status` and SKIP scoring for invalid profiles (never
score a friend against a broken profile silently).

## Tasks

1. **Global discovery** (`jobify/hosted/discovery.py`) — union of all users'
   `portals.yml` boards (dedup by portal), fetch once via the existing
   `jobify/hunt/sources`, resolve links, upsert into `postings` keyed by
   `jobify.shared.jobid` (update `last_seen_at` on conflict). Service-role
   writes. Zero LLM tokens.

2. **Per-user fan-out** (`jobify/hosted/fanout.py`) — for each user with a
   valid profile, run the ladder against postings not yet in `matches`:
   - Stage 1: the user's title pre-filter.
   - Stage 2: `compiled_rubric` via H2's `score_posting`; compile it first
     (H2's `compile_rubric`, `event='rubric_compile'` ledger row) when NULL.
     Hard-disqualified postings get NO matches row (don't pollute the feed);
     others get `rubric_score` + `reason_source='rubric'`.
   - Stage 3: embedding rerank — cosine(profile embedding, posting embedding).
   - Stage 4: LLM verdict (Haiku-class, through `jobify.shared.llm`) for the
     top-N survivors per user per run (default N=15, env-tunable), writing
     `llm_score` + `reason` + `reason_source='llm'` and an `event='llm_verdict'`
     ledger row each. **Check `budget_caps` vs the ledger month-to-date before
     stage 4** — over cap, skip stage 4 entirely (feed degrades to rubric+embed,
     per plan §4). Full caps enforcement is H6; this check is the minimum.

3. **Embeddings** (`jobify/hosted/embed.py`) — decide the provider and
   document it in `docs/SCORING.md`. Default recommendation: Voyage
   (`voyage-3.5-lite` class) — verify the model's output dimension and if it
   isn't 1024, ship `0004_worker.sql` altering the two `vector(1024)` columns
   (additive-safe, both are still NULL everywhere). Posting embeddings are
   computed once globally, profile embeddings once per profile change; both
   get `event='embedding'` ledger rows. `EMBEDDINGS_ENABLED=false` (or a
   missing key) must cleanly skip stage 3 — the ladder still works 1→2→4.

4. **Entry point + schedule** — `jobify-hosted-hunt` console script
   (`pyproject.toml`), one cycle = discovery → fan-out → summary log line
   (users, postings, matches written, tokens spent). A
   `.github/workflows/hosted-hunt.yml` cron (disabled-by-default /
   `workflow_dispatch` until infra exists), modeled on the existing hunt
   workflow.

5. **Tests** — fakes throughout (no network): discovery dedupes postings
   across two users' overlapping portals; fan-out isolation (the regression
   test above); ladder ordering (stage-4 only touches top-N by stage-2/3
   composite); budget stop (cap hit → zero `llm_verdict` events); invalid
   profile → `validation_status` written + user skipped; embeddings-off
   degradation. Existing single-user hunt tests must stay green untouched.

## Exit criteria

- Full suite green, no network. `jobify-hunt` (single-user path) behavior
  unchanged.
- The lru_cache regression test exists and passes.
- `git diff --stat`: nothing under `web/`, `dashboard/`, `jobify/tailor/`,
  `jobify/submit/`; `0002`/`0003` untouched.
- Commit: `H4: shared discovery + per-user scoring ladder fan-out (rubric/embed/LLM top-N) + budget stop`.
- Push the branch; do NOT merge — review-then-merge.
