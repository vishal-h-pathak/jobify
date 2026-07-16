# Task 3 report: `GET /api/tailor/runs?posting_id=` (poll + stale reaping)

## What I implemented

- `web/lib/tailor/pollRuns.ts` — core logic, deps-injected (`admin`,
  `supabase`, `userId`, `postingId`, `now`, `staleMinutes`), factored out of
  the route exactly the way `dispatchTailor.ts` is factored out of
  `POST /api/tailor/run`:
  - SELECT via the **authed** `supabase` client: `select("*").eq("user_id",
    userId).eq("posting_id", postingId).order("created_at", { ascending:
    false })` — RLS restricts this to the caller's own rows; the explicit
    `.eq` filters are belt-and-suspenders, not the only gate.
  - Stale-reap UPDATE via the **admin** client only: a single batched
    `update({ status: "failed", error: STALE_REAP_ERROR, updated_at:
    now().toISOString() }).in("id", staleIds)`, issued only when
    `staleIds.length > 0` (no admin call at all when nothing is stale).
  - Reaped rows' `status`/`error`/`updated_at` are merged into the returned
    array in-process, so the caller sees the reap take effect on this same
    response without re-polling.
  - Response shape is trimmed per the brief's suggested (non-mandatory)
    option: `{ id, status, mode, template, feedback, progress,
    dropped_count, error, cost_usd, created_at, updated_at }` —
    `user_id`/`posting_id`/`doc_sha256` dropped.
- `web/app/api/tailor/runs/route.ts` — thin wrapper: auth gate (mirrors
  `hunt/run/route.ts:20-32` exactly), `posting_id` query-param parsing +
  400, then `pollRuns(...)` with `staleMinutes = 10`, wraps the result in
  `NextResponse.json`. Flat query-param route (no dynamic segment), same
  style as the existing `GET /api/admin/profile-review`.

## Judgment calls

- **Staleness boundary**: "more than 10 minutes before now()" is
  implemented as strict `age > staleMinutes * 60_000` — a row exactly at
  the 10-minute mark is **not** reaped, only strictly older. Documented in
  a doc comment on `pollRuns`. Tested both the brief's requested case
  (9:59, not stale) and the literal boundary (exactly 10:00, not stale) to
  pin down the choice unambiguously.
- **Response shape**: chose the trimmed shape the brief listed as slightly
  more honest about what a poller needs, over echoing the full row.

## Tests — TDD evidence

**RED** (`pollRuns.test.ts` written first, module didn't exist yet):
```
FAIL  lib/tailor/pollRuns.test.ts [ lib/tailor/pollRuns.test.ts ]
Error: Cannot find module './pollRuns' imported from '.../pollRuns.test.ts'
```

**GREEN** after implementing `pollRuns.ts` (one intermediate failure fixed
along the way — my own test used `.in()`'s single-array-arg form instead of
Supabase's real `(column, values)` two-arg signature; fixed the test
assertion, not the implementation):
```
✓ lib/tailor/pollRuns.test.ts (9 tests) 4ms
```

`pollRuns.test.ts` cases (9): rows unmodified when none stale (+ trimmed-shape
assertions); reaps a queued row older than 10 min (admin update-call args +
reaped status/error/updated_at in the response); does NOT reap at 10:00 minus
1s; does NOT reap at exactly 10:00 (the chosen boundary, explicit); does NOT
reap running/succeeded/failed regardless of age; empty result set returns
`{ runs: [] }`; throws on SELECT error; throws on UPDATE error; query scoped
to the right `user_id`/`posting_id`, ordered `created_at desc`.

`route.test.ts` (7, written after the route.ts wrapper already existed —
precedent from `hunt/run/route.test.ts` and `admin/profile-review/route.test.ts`
both have route-level tests, and these two scenarios are route-level, not
`pollRuns`-level): 401 signed out; 403 no invite; **400 on missing
`posting_id`** (distinct from the empty-results case — never calls
`pollRuns`, never constructs the admin client); 200 + `{ runs: [] }` for a
valid-but-matchless `posting_id`; correct `userId`/`postingId`/
`staleMinutes: 10` passed through; returns whatever `pollRuns` produced
(e.g. a reaped row); admin bypasses the invite check. All 7 passed on first
run (the route wrapper logic was already correct from writing it alongside
`pollRuns.ts`).

## Full verification

From `web/`:
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean on all new/touched files (5 pre-existing errors in
  `app/(app)/profile/page.test.tsx`, untouched by this task, unrelated
  `react/no-unescaped-entities`).
- `npm test` — **102 test files, 915 tests, all passing** (16 new: 9 in
  `pollRuns.test.ts`, 7 in `route.test.ts`).
- `bash scripts/scrub_gate.sh` (repo root) — PASS.

## Files changed

- `web/lib/tailor/pollRuns.ts` (new)
- `web/lib/tailor/pollRuns.test.ts` (new)
- `web/app/api/tailor/runs/route.ts` (new)
- `web/app/api/tailor/runs/route.test.ts` (new)

## Self-review

- Authed `supabase` client used for the SELECT only; `admin` client used
  only for the stale-reap UPDATE — confirmed by reading `pollRuns.ts` and
  by the fakes in `pollRuns.test.ts` never sharing a client.
- Reap filter is `r.status === "queued" && age > staleMs` — explicitly
  excludes `running`/`succeeded`/`failed`, covered by a dedicated test with
  all three statuses at very old ages, none touched.
- Reaped status/error/updated_at flow into the same response object
  (`runs.map` merges based on `staleIdSet`), covered by an assertion on
  `result.runs[0]` in the reap test — no re-poll needed.
- All brief-listed `pollRuns.test.ts` cases present, plus two extra I added
  (SELECT/UPDATE error propagation, exact query-args assertion) for parity
  with `dispatchTailor.test.ts`'s error-throwing rigor.
- Added `route.test.ts` beyond what the brief's file list named, because
  the self-review checklist explicitly requires the 400-missing-param case
  to be distinct from the empty-results case, and that logic lives in the
  route, not in `pollRuns` (which always receives a non-null `postingId` by
  its own type signature). Confirmed against precedent
  (`hunt/run/route.test.ts`, `admin/profile-review/route.test.ts`) that
  this session's established pattern does test route wrappers directly via
  module-mocking, so this fills a real gap the brief's own checklist
  flagged rather than being scope creep.

## Note on this report file

This file previously contained stale content from an unrelated prior task
(LIV-1 "MirrorPanel retry-affordance parity") — evidently left over from a
different worktree/session sharing this path pattern. It has been fully
overwritten with this task's actual report; the old content is not related
to this session or this task in any way.

No blockers, no ambiguities that weren't already flagged as "your call" in
the brief.
