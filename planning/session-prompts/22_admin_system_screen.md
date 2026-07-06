# Session 22 — ADM-2: Admin "System" screen  (Hosted wave 8, single session)

**Model: Sonnet.** Decisions are made — implement faithfully.
**Run from:** a `jobify-wt/hosted-adm2-system` worktree.
**Depends on:** wave 7 (HNT-1) merged to main — the worker's cycle-summary
counters and `--user`/`--discovery-only` modes must exist first.
**You own:** `web/app/(app)/admin/**`, `web/lib/admin/**`,
`jobify/hosted/**` (cycle-persist only), `jobify/db.py` (one insert helper),
`jobify/migrations/0008_hunt_cycles.sql` (new), docs, tests. Off-limits as
always: `jobify/tailor/`, `jobify/submit/`, `jobify/shared/status.py`,
`dashboard/`, migrations 0001–0007, `web/components/ui/**`.

---

## Why

The operator can mint invites and see users/spend, but nothing explains or
measures the machine itself. This screen is the single place to answer "what
is this system doing and is it working?" — for the operator, and honestly
it's also the demo page for anyone technical.

## Tasks

1. **Migration `0008_hunt_cycles.sql`** (additive, idempotent, conventions of
   0002–0007): `hunt_cycles` — `id BIGINT GENERATED ALWAYS AS IDENTITY
   PRIMARY KEY`, `started_at TIMESTAMPTZ NOT NULL`, `finished_at TIMESTAMPTZ`,
   `mode TEXT NOT NULL` (`full` | `discovery_only` | `single_user`),
   `triggered_by TEXT` (`cron` | `dispatch` | `manual`), `users_scored
   INTEGER NOT NULL DEFAULT 0`, `postings_fetched INTEGER NOT NULL DEFAULT 0`,
   `postings_upserted INTEGER NOT NULL DEFAULT 0`, `counters JSONB` (the
   worker's full counter dict — stage funnel, budget stops, stage4 calls),
   `cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0`, `error TEXT`. RLS enabled,
   NO policies (service-role only — admin page reads via the gated
   service-role client). Index on `started_at DESC`.
2. **Worker persist** (`jobify/hosted/worker.py` + `jobify/db.py`
   `insert_hunt_cycle_row(...)`): at end of every cycle (all modes, success
   AND failure — wrap so a persist failure only logs, never crashes a
   cycle), write one row from the counters it already assembles for the
   log/ntfy summary. Cost = sum of this cycle's ledger writes (thread the
   run's accumulated cost through — the counters already track stage4/embed
   calls; add a running cost accumulator if one doesn't exist).
3. **Admin nav**: `/admin` becomes two tabs (existing overview = "Operations",
   new = "System") — small tab bar using existing primitives; both behind
   `requireAdmin()` exactly like the current page.
4. **`/admin/system` — top half, "How it works":** a static, well-written
   explainer (server component, no LLM): the four-stage scoring ladder
   (title filter → compiled rubric → embedding rerank → budget-gated LLM
   verdict on the top-N), shared global discovery, the three budget layers,
   the invite/auth model, and the on-demand hunt flow (button → dispatch →
   worker). Source the FACTS from docs/SCORING.md, docs/COST_RAILS.md,
   docs/OPERATIONS.md — do not contradict them; link each section to its
   doc on GitHub is NOT possible (repo slug is scrub-gated) so no links,
   just doc filenames as citations. Render as sectioned Cards with a simple
   text/arrow pipeline diagram (monospace, no images).
5. **Bottom half, "How it's performing"** (all queried server-side via the
   admin-gated service-role client; handle empty tables gracefully):
   - Recent cycles table (last 15 `hunt_cycles`): when, mode, trigger,
     users, postings, stage-4 calls, cost, error badge if any.
   - Ladder funnel for the most recent scoring cycle (from `counters`):
     postings considered → passed title filter → rubric-scored → embedded →
     LLM verdicts, as a simple horizontal bar list with counts.
   - Cost: MTD pool spend vs cap (reuse pool-health helper), split by event
     type and by model (ledger GROUP BY), pool vs BYO.
   - Engagement: matches by state (total + last 7 days), saves:dismissals
     ratio, per-user applied counts.
   - Pool freshness: postings count, newest/oldest `last_seen_at`, expired
     count.
6. **Docs**: short section in docs/OPERATIONS.md ("System screen — what the
   numbers mean", incl. that `hunt_cycles` only has rows from wave-8
   onward).

## Tests

Python: `insert_hunt_cycle_row` payload shape; worker persists on success
and on simulated failure (error row written, cycle exception still raised
or logged per existing behavior); persist-failure doesn't crash the cycle.
Web: system page gated (redirects non-admin), renders with empty tables
(zero cycles), funnel math from a fixture counters dict, cost aggregation
from fixture ledger rows. All fakes, follow repo patterns.

## Exit criteria

- Full Python suite + web vitest + tsc + `npm run build` green; scrub gate
  PASS (no repo slugs/emails/domains in the explainer!).
- `git diff` respects the ownership list; 0001–0007 untouched.
- Commit: `ADM-2: hunt_cycles telemetry + /admin/system — how-it-works explainer + live performance panels`.
- Push; do NOT merge — review-then-merge. Reminder for the reviewer: apply
  0008 to the live project and `vercel --prod` after merge (no auto-deploy).
