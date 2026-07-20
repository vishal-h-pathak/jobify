# Session 47 — HUNT2-S1: P0 "stop the bleeding"  (worktree `feat/hunt2-s1`)

**Model: Sonnet.** The spec is `planning/HUNT2_SOURCES.md` §1-§2 — read it FIRST,
in full. This prompt pins contracts and boundaries; the spec's P0 table
(P0.1-P0.7) defines the work. Scope is P0 ONLY — no P1/P2/P3 work, no scoring
sophistication beyond what P0.3/P0.7 require.

## Constitutional rules (verbatim, non-negotiable)
1. `bash scripts/scrub_gate.sh` must PASS before your final commit. No operator
   strings anywhere (names, emails, employers). Fixtures/tests use the
   Alex Quinn persona.
2. Migration files are COMMITTED, never applied. You own
   `jobify/migrations/0014_hunt2_funnel.sql` — write it, test it against a
   local schema reconstruction if you wish, but do NOT touch the live DB.
   (Session 48 owns 0015 — do not create or reference 0015.)
3. Every LLM call writes a `budget_ledger` row. P0 adds NO LLM calls —
   discovery stays zero-LLM. If you find yourself wanting an LLM call, stop
   and flag it in your report instead.
4. `matches` has NO `id` column (composite PK `user_id, posting_id`). Never
   `select("id")` from it.
5. Commit on `feat/hunt2-s1` only. Do NOT push, do NOT merge, do NOT deploy.

## The seven items (spec §2 has the full table — these are the pins)

**P0.1 — Remove the legacy Atlanta filter.** Grep every fetcher under
`jobify/hunt/sources/` and the hosted discovery path for inherited location
constants/filters ("atlanta", "GA", metro lists, lat/long). Delete the
filtering; discovery is location-agnostic. Add a unit test asserting no
fetcher module references a location constant.
⚠ HARD CONSTRAINT: P0.1 may not land without P0.7 in this same session —
removing the filter without tier ranking is a regression (owner directive,
spec §1 "Location policy").

**P0.2 — remote plumb-through + inference.**
- `jsearch.py` (~lines 148-156): stop discarding `job_is_remote`; map to
  tri-state.
- New shared helper `jobify/hunt/sources/remote_infer.py`:
  `infer_remote(location_str, raw) -> True|False|None`. Pattern-match
  "remote"/"anywhere"/"distributed" (+ structured per-source fields where
  present). RemoteOK / We Work Remotely / Remotive are remote-only by
  definition → hardcode `True` at the fetcher.
- Greenhouse/Ashby fetchers call the helper.
- If `postings` lacks a nullable `remote boolean` column in the live schema
  (check migrations 0001-0013 — do not guess), add it in 0014.

**P0.3 — Dealbreakers restored.** Find the profile→rubric compile path in the
hosted fanout (`jobify/hosted/`) and restore the `dealbreakers →
hard_disqualifiers` mapping the port severed. Test: a compiled rubric for an
Alex Quinn fixture profile contains its dealbreakers; a synthetic posting
violating one is disqualified BEFORE the LLM stage.

**P0.4 — Loud empty-board skip.** `jobify/hosted/discovery.py` (~184-185):
WARN log + counters `boards_total / boards_fetched / boards_skipped_empty`
emitted into the run summary / counters jsonb (same place `first_error`
already lands). No silent skips.

**P0.5 — Full-funnel matches rows.** Every SCORED posting writes a matches row:
`status ∈ {surfaced, rejected_title, rejected_rubric, rejected_rerank,
rejected_llm}` + short `reject_reason text`. Columns go in 0014
(`status text not null default 'surfaced'`, `reject_reason text`,
`location_tier smallint` — see P0.7). CRITICAL COMPANION CHANGE: grep
`web/` for every read of `matches` (feed queries, the state route's
`count: "exact"` badge, anything user-facing) and add
`.eq("status", "surfaced")` so rejected rows never leak into the UI or
counts. Default `'surfaced'` keeps existing rows valid. Test: after a
simulated scoring pass, `status` counts reconstruct the funnel shape and the
web feed/count queries return surfaced-only.

**P0.6 — Per-user query templates (interim, zero-LLM).** Replace the 4
hardcoded SerpAPI/JSearch query strings with template expansion per user:
top ~3 target titles from the profile's targeting tiers × (remote-accepting →
"remote"; always also × preferred metro if one exists). Dedup identical
queries ACROSS users before spending paid calls; cap at **12 paid queries per
provider per discovery run** (log what was dropped). Test: two fixture users
with different titles/locations → different query sets; owner-like fixture no
longer emits "atlanta" unless the profile says so; cap enforced.

**P0.7 — Location-tier ranking (owner directive).** Per-user, derived from
profile (`preferred metros` + remote acceptability):
- tier 1: posting in a preferred metro OR (`remote=true` AND user accepts remote)
- tier 2: `remote` null / ambiguous location
- tier 3: onsite/hybrid outside preferred metros — DISQUALIFIED instead only
  if the user's dealbreakers say so (then it's a rejected_rubric row, P0.5)
Persist `location_tier` on the matches row at scoring time; surfaced results
are ordered `(location_tier asc, score desc)` — update the web feed query's
ordering accordingly. Test with synthetic postings: every tier-1 match ranks
above every tier-3 match regardless of raw score; tier-2 never outranks
tier-1.

## Verification (all must pass)
`pytest` (repo root), and because P0.5/P0.7 touch web: `cd web && npx tsc
--noEmit && npx vitest run && npm run build`. Then `bash
scripts/scrub_gate.sh`. Budget: aim ≤~600 changed lines excluding tests.

## Report format
Per-item P0.1-P0.7: done/partial + files touched + test names. Then: 0014
migration summary (exact DDL), the web `matches`-read call sites you patched,
suite results verbatim, scrub result, and anything ambiguous you decided
(with your reasoning). Do not begin until the owner confirms.
