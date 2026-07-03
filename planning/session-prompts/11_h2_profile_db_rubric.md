# Session 11 — H2: DB profile backend + compiled-rubric scorer  (Hosted wave 1)

**Run from:** a `jobify-wt/feat/hosted-h2-profile-backend` worktree.
**Depends on:** the `profiles` **contract** in `10_h1_multitenant_schema.md` (the
table itself lands in H1's branch — code against the contract; integration is
verified at merge).
**Parallel-safe with:** H1 (10) — you own `jobify/profile_loader.py`,
`jobify/hunt/rubric.py` (new), and their tests. Do NOT touch `jobify/migrations/`
or `jobify/shared/` — H1 owns those this wave.

---

## Context

Read `planning/HOSTED_AGGREGATOR_PLAN.md` §3–§4. Two deliverables: (1) profiles
can live in a DB row instead of a directory, with zero changes to downstream
consumers; (2) the static half of the scoring ladder — an onboarding-time
LLM-compiled rubric that scores postings in pure Python, zero tokens per posting.

The `profiles` row contract (must match H1 exactly): `user_id uuid PK`,
`doc jsonb` (keys = the eight profile-file names, values = file contents as
text), `compiled_rubric jsonb`, `embedding vector(1024)`, timestamps.

## Tasks

1. **DB profile backend via materialization** — keep it boring: fetch the
   `doc` JSONB for a user, write the eight files into a per-user cache dir
   (`~/.cache/jobify/profiles/{user_id}/` or `JOBIFY_PROFILE_CACHE`), and let the
   existing dir-based loader do everything else. Resolution order in
   `profile_loader.profile_dir()` becomes:
   1. `JOBIFY_PROFILE_DIR` (unchanged)
   2. **`JOBIFY_PROFILE_USER_ID` set** → materialize from Supabase (via
      `jobify.db`) and return the cache dir; re-materialize when the row's
      `updated_at` is newer than the cache stamp
   3. `<repo>/profile/` (unchanged)
   4. `<repo>/profile.example/` (unchanged)
   Validate materialized profiles with the existing
   `onboarding/validate_profile.py` logic (import, don't shell out, if
   practical). Tests use a fake Supabase client — no live DB in unit tests.

2. **Rubric schema + compiler** — new `jobify/hunt/rubric.py`:
   - **Schema** (versioned, `rubric_version: 1`): weighted keyword/phrase groups
     (e.g. `{"group": "agentic_ai", "weight": 3.0, "terms": [...]}`) matched
     against title+description; disqualifier regexes (hard reject, with a
     `reason` string each); gates: location/remote, comp floor when parseable,
     degree gate; tier hints mapping title patterns → tier. Score output
     normalized 0–1 with a per-part breakdown.
   - **Compiler**: one LLM call (Sonnet-class) taking `thesis.md`,
     `disqualifiers.yml`, and `profile.yml` targeting tiers → rubric JSON.
     Structured output, validated against the schema; retry-once-on-invalid then
     raise. Route the call through the existing LLM chokepoint used by the hunt
     scorer (so H6's cost ledger later sees it) — do not add a second Anthropic
     client path.
   - **Scorer**: `score_posting(rubric, posting) -> RubricResult(score, tier_hint,
     reasons, disqualified)`. Pure Python, deterministic, no I/O, no tokens.
   - **Feedback hook**: `apply_feedback(rubric, events) -> rubric` — save/dismiss
     events nudge matched-group weights (bounded multiplicative updates, clamped;
     document the constants). Plus `needs_recompile(events)` heuristic for the
     nightly recompile decision. Keep it simple and unit-tested; no scheduler
     wiring here (that's H4/H6).

3. **Tests** — fixtures with the `profile.example/` persona ("Alex Quinn"):
   a hand-written valid rubric fixture; scorer unit tests covering strong match /
   weak match / regex disqualifier / gate rejection; determinism test (same
   input → identical output, twice); compiler tested against a faked LLM
   response (valid + invalid → retry path). NOTE: assume no live Anthropic
   credits locally — everything must pass with fakes; put any live-compile
   check behind an env-gated integration marker.

4. **Docs** — short section in `docs/ARCHITECTURE.md` (or a new
   `docs/SCORING.md`, your call): the four-stage ladder, what the rubric schema
   looks like, when it recompiles.

## Exit criteria

- Full test suite green with no network and no live DB.
- `JOBIFY_PROFILE_USER_ID` path proven by unit test with a fake client;
  existing dir-based resolution behavior byte-identical for cases 1/3/4.
- `git diff --stat` shows no changes under `jobify/migrations/`,
  `jobify/shared/`, `jobify/tailor/`, `jobify/submit/`.
- Commit: `H2: DB profile backend (materialized cache) + compiled-rubric static scorer + feedback hook`.
- Push the branch; do NOT merge — review-then-merge.
