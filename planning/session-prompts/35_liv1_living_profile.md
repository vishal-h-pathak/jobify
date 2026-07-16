# Session 35 — LIV-1: The living profile — feedback loop + change-log  (single session, off main)

**Model: Sonnet.** Vision: PRODUCT_VISION.md §2 "living profile" + V3A_DESIGN.md
§3's change-log stub. V3a is on main — branch `feat/liv1-learning` off main,
worktree `jobify-wt/liv1-learning`.
**You own:** `jobify/hosted/**` (new `learning.py`), `jobify/db.py` (reads +
rubric persist helper if missing), `web/lib/dossier/derive.ts` (+test —
change-log parsing ONLY), tests, docs. Do NOT touch `jobify/hunt/rubric.py`
(consume `apply_feedback`/`needs_recompile`/`score_posting` — they exist from
H2), `jobify/tailor|submit`, web app pages/components, migrations (NONE —
see event-store note).

## Design (decided — no migration)
The event store is `learned-insights.md` inside `profiles.doc` — it ships
empty by contract and was always meant to accumulate. A watermark header
line (`last-processed: <ISO>`) makes the learning pass incremental without
any new table. The dossier change-log derives from this file's dated
entries + module completion timestamps.

## Tasks
1. **`jobify/hosted/learning.py` — the learning pass**, run inside the
   user-scored fan-out cycle (after scoring): collect this user's
   `posting_reactions` and `matches` state changes (`state_changed_at` >
   watermark; states saved/dismissed/applied + reactions). For each event,
   re-run H2's pure `score_posting` against the CURRENT rubric to recover
   `matched_groups` from the breakdown, then build the event list and call
   `apply_feedback`; persist the updated `compiled_rubric`. When
   `needs_recompile(events)` → full `compile_rubric` (one ledger row,
   `event='rubric_recompile'`). Zero LLM otherwise.
2. **Insight entries:** append dated, human-readable lines to
   `learned-insights.md` (e.g. `- 2026-07-16: downweighted "agency work"
   after 3 dismissals; upweighted "platform ownership" after 2 saves`),
   derived from the actual weight deltas (report groups whose weight moved
   >5%). Update the watermark. Never rewrite prior entries (append-only).
   Failure anywhere logs + skips — a learning error must never break
   scoring.
3. **Dossier change-log** (`derive.ts`): parse `learned-insights.md` dated
   entries + module `completed_at` receipts into the change-log the B3 stub
   shaped ("learning starts after your first hunts" empty state already
   exists — now fill it when entries exist). Pure parsing only.
4. **Parked polish (small, in scope):** MirrorPanel in-panel retry on
   generate-failure + Metrics/Mirror retry-affordance parity (B2's two
   non-blocking follow-ups). Files: those two panels + tests only.
5. **Docs:** SCORING.md gains a "Learning loop" section (events → reweight →
   recompile threshold → insights).

## Tests
Learning pass: watermark incrementality (events before it ignored);
matched-groups recovery via score_posting; reweight persisted; recompile
fires at threshold with exactly one ledger row; append-only insights +
>5%-delta reporting; failure isolation (a throwing step leaves scoring
intact). derive.ts: entry parsing, empty state preserved, module receipts
interleaved chronologically. Panels: retry paths. All fakes; existing
suites untouched and green.

## Exit criteria
Full Python + web suites, tsc, build green; scrub gate PASS; diff inside
ownership. Commit: `LIV-1: living profile — feedback learning pass, insight entries, dossier change-log, mirror retry polish`.
Push; do NOT merge — review-then-merge.
