# SCORING — the hosted scoring ladder

Hosted jobify (`planning/HOSTED_AGGREGATOR_PLAN.md` §4) fans discovery out
across every user but keeps LLM cost per-user near zero by gating each
posting through four increasingly expensive stages, cheapest first. Each
stage prunes for the next; marginal LLM cost per posting per user
approaches zero as more users share the same discovery + embedding work.

```
1. Title pre-filter        static, per-user portals.yml            (existing)
2. Compiled rubric         static, per-user, zero tokens/posting    (this doc — jobify/hunt/rubric.py)
3. Embedding rerank        cosine(profile embedding, posting embed) (H4)
4. LLM verdict             Haiku fit+legitimacy, top-N survivors    (existing single-user scorer,
                                                                      per-cycle MTD-spend-vs-cap stop
                                                                      shipped H4 Task 3; full caps
                                                                      enforcement — mid-run re-checks,
                                                                      notifications — still H6)
```

## Global discovery — no per-profile title filter

Discovery (`jobify/hosted/discovery.py`) populates the shared `postings`
pool WITHOUT any per-profile title filtering: its four portal-based
fetches (Greenhouse/Lever/Ashby/Workday) are all called with
`apply_title_filter=False`. Those fetchers otherwise gate every posting
through `passes_title_filter()`, which resolves through the single-user
CLI's process-global `_PORTALS_CACHE` for whichever ONE profile happens
to be active — applying that one profile's title/seniority preferences
at discovery time would silently drop postings from the SHARED pool
before any other hosted user ever saw them (fixed in commit `ae2a789`).
Per-user title filtering happens downstream instead, in stage 1 of each
user's fan-out ladder (`jobify/hosted/fanout.py`), against the full pool.

## Stage 2 — the compiled rubric

The single-user pipeline's `jobify.hunt.scorer` calls Claude once **per
posting** (`score_job`). That doesn't scale to many users sharing a
global postings pool — most postings are an obvious pass/reject for a
given user's judgment, and re-deriving that with an LLM call every time
is the single biggest avoidable cost in the funnel.

`jobify/hunt/rubric.py` distills a user's judgment into a rubric **once**,
at onboarding time (or on recompile — see below), then scores every
posting against it in pure Python. Zero I/O, zero tokens, deterministic:
the same `(rubric, posting)` pair always produces the same
`RubricResult`.

### Compiling

`compile_rubric(thesis, disqualifiers_text, targeting_text)` makes one
Sonnet-class call (`COMPILER_MODEL`), routed through the same
`jobify.shared.llm.complete` chokepoint the per-posting Opus scorer
uses — no second Anthropic client path, so a cost ledger reading that
chokepoint sees every call in one place. Inputs:

- `thesis.md` — the canonical hunting judgment (tiers, hard constraints,
  energy signals).
- `disqualifiers.yml` — hard dealbreakers + soft concerns.
- the targeting-tier block from `profile.yml`.

The response must be JSON matching the schema below; `validate_rubric()`
checks it. On invalid JSON or a schema violation, `compile_rubric` retries
once with a fresh call, then raises `ValueError` — it never silently
returns a broken rubric.

### The rubric schema (`rubric_version: 1`)

```json
{
  "rubric_version": 1,
  "term_groups": [
    {"group": "platform_infra_ownership", "weight": 5.0, "terms": ["platform engineer", "own a service", "..."]}
  ],
  "disqualifiers": [
    {"pattern": "(?i)\\bcrypto\\b|\\bweb3\\b", "reason": "Crypto / Web3 — not a domain of interest"}
  ],
  "gates": {
    "location": {"remote_acceptable": true, "base_location_substring": "denver"},
    "comp_floor_usd": 165000,
    "degree_gate": true
  },
  "tier_hints": [
    {"pattern": "(?i)platform|infrastructure", "tier": 1}
  ]
}
```

- **`term_groups`** — weighted keyword/phrase groups. A group scores
  present-or-absent (any term found in `title + description`, case
  insensitive substring match) and contributes its full `weight`; the
  posting's score is `matched_weight / total_weight`, always in `[0, 1]`.
- **`disqualifiers`** — regexes matched against `title + description`.
  Any hit short-circuits scoring: `score = 0.0`, `disqualified = True`,
  `reasons` records which one and why.
- **`gates`** — hard pass/fail checks, independent of the term-group
  score:
  - `location` — fails (and disqualifies, mirroring thesis.md's "violating
    any of these = score floor, do not surface") when the posting is
    on-site and outside `base_location_substring`, or remote and
    `remote_acceptable` is false.
  - `comp_floor_usd` — fails when a USD figure can be parsed out of the
    description (lowest figure found, so a stated range gates on its low
    end) and it's below the floor. Skipped entirely when nothing
    parses — the gate never guesses.
  - `degree_gate` — **soft**, not a disqualifier: mirrors the existing
    per-posting scorer's `degree_gated` semantics (an MS/PhD-required
    posting with no "or equivalent experience" escape hatch is still
    surfaced, just flagged in `reasons`).
- **`tier_hints`** — ordered regexes matched against the title only;
  first match sets `RubricResult.tier_hint`.

### Scoring

`score_posting(rubric, posting) -> RubricResult` is pure: no I/O, no
mutation, no tokens. `RubricResult` carries `score` (0.0-1.0), `tier_hint`,
`reasons` (a human-readable trail — which groups matched, which gate/
disqualifier fired), `disqualified`, and a `breakdown` dict of
per-term-group contributions (consumed by the feedback hook below).

### Feedback and recompiling

Save/dismiss signals from the feed nudge the rubric between full
recompiles, cheaply:

- `apply_feedback(rubric, events)` — each event is
  `{"action": "save" | "dismiss", "matched_groups": [...]}` (the
  `matched_groups` a prior `score_posting` call reported in its
  `breakdown`). A `save` multiplies each matched group's weight by
  `FEEDBACK_SAVE_MULTIPLIER` (1.05); a `dismiss` by
  `FEEDBACK_DISMISS_MULTIPLIER` (0.95). Weights are clamped to
  `[FEEDBACK_WEIGHT_MIN, FEEDBACK_WEIGHT_MAX]` (0.1-10.0) so no amount of
  feedback can zero out or dominate a group. Returns a new rubric; the
  input is never mutated.
- `needs_recompile(events)` — the yes/no heuristic a nightly job (wiring
  is H4/H6's job, not this module's) uses to decide whether incremental
  nudging is enough or a fresh `compile_rubric` pass is warranted: true
  once `NEEDS_RECOMPILE_MIN_EVENTS` (20) events have accumulated, or once
  dismissals exceed `NEEDS_RECOMPILE_DISMISS_RATIO` (60%) of events.

## Stage 3 — embedding rerank

`jobify/hosted/embed.py` (H4 Task 2) computes vector embeddings for
postings and profiles so stage 3 can rerank stage 2's survivors by
`cosine(profile_embedding, posting_embedding)` before stage 4 spends any
LLM tokens.

**Provider: Voyage AI, `voyage-3.5-lite`.** Confirmed against Voyage's
docs (2026-07): `voyage-3.5-lite` supports an explicit `output_dimension`
parameter with valid values `{256, 512, 1024, 2048}` (default 1024). We
request `output_dimension=1024` explicitly on every call so the vectors
match the existing `vector(1024)` columns on `profiles.embedding` and
`postings.embedding` (`jobify/migrations/0002_multitenant.sql`) — no
dimension-altering migration was needed.

**Cost:** $0.02 per 1M input tokens (first 200M tokens free on a new
Voyage account), no separate output-token charge for embeddings. A
typical posting description (~500-800 tokens after the existing 3000-char
truncation the hunt sources already apply) costs roughly $0.00001-0.000016
— and it's paid ONCE per posting, shared across every user who ends up
matched against it, not once per user. Every embedding call writes an
`event='embedding'` row to `budget_ledger` (real token counts from
Voyage's `total_tokens` response field, not estimated): posting-embedding
rows use `user_id=None` (a global, unattributed cost —
`jobify/migrations/0004_worker.sql` drops `budget_ledger.user_id`'s NOT
NULL for exactly this case); profile-embedding rows use the specific
`user_id`.

**Degradation:** embeddings are OFF — cleanly skipped, no exception, no
network call — whenever `EMBEDDINGS_ENABLED=false` (or unset with
`VOYAGE_API_KEY` empty). `jobify.hosted.embed.embeddings_enabled()` is the
single source of truth every call site checks first; `embed_texts()` and
the `ensure_*_embedding()` helpers all return `None`/`False` rather than
raising in that state. The ladder still works end-to-end (stage 1 -> 2 ->
4) with stage 3 skipped — Task 3's fan-out treats a missing embedding
exactly like "no rerank happened," not an error.

**Profile-embedding staleness:** a user's profile embedding is only
recomputed when their profile actually changed since the last compute —
tracked via a small `.embedding_stamp` file next to the per-user
materialized cache dir, recording the `profiles.updated_at` value the
embedding currently reflects (fixed in commit `e7573f4`; see
`jobify/hosted/fanout.py::_embedding_is_stale`/`_mark_embedding_fresh`).
Posting embeddings need no equivalent mechanism — a posting's text never
changes after first sight, so `get_posting_embedding` reusing an existing
vector is always correct.

## Profile source: directory or DB row

Everything above reads the profile through `jobify.profile_loader`, which
is agnostic to where the eight files actually live. Hosted adds a second
resolution step ahead of the single-user directory fallback:

1. `JOBIFY_PROFILE_DIR` (unchanged — explicit directory override).
2. `JOBIFY_PROFILE_USER_ID` — materializes the `profiles.doc` JSONB row
   (H1's `0002_multitenant.sql` contract) for that user into a per-user
   cache dir (`JOBIFY_PROFILE_CACHE`, default
   `~/.cache/jobify/profiles/{user_id}/`), validates it in-process via
   `onboarding.validate_profile.validate_profile_dir`, and returns the
   cache dir. Re-materializes only when the row's `updated_at` is newer
   than what produced the on-disk cache.

   The validation verdict is a hard gate, not just a log line: it's
   persisted to `profiles.validation_status`
   (`jobify.profile_loader.VALIDATION_STATUS_VALID` /
   `VALIDATION_STATUS_INVALID`, `_validate_materialized`), and the fan-out
   worker (`jobify/hosted/fanout.py::_run_user_ladder`) reads that column
   before running ANY stage for a user — `'invalid'` skips the user
   entirely for the cycle (counted in `users_skipped_invalid`), never
   scoring them against a broken profile. `None` (never validated, e.g.
   `onboarding` not importable) is treated as "proceed," fail-open. A
   warning is still logged on a failed check as an operator signal, but
   the DB write is what downstream code actually reads.
3. `<repo>/profile/`, then `<repo>/profile.example/` (unchanged).

Every downstream consumer — the rubric compiler, the per-posting scorer,
the tailor, the submit pre-fill — is unaffected either way; they only
ever call `jobify.profile_loader`'s public loaders.
