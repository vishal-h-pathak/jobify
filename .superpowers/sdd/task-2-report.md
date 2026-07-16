# Task 2 report: `dispatchTailor.ts` + `POST /api/tailor/run`

## What I implemented

- `web/lib/tailor/dispatchTailor.ts` — `dispatchTailor(deps)`, the
  dependency-injected core dispatch logic (`admin`/`fetchImpl`/`now`
  injected, no `NextResponse` inside the file), mirroring
  `web/lib/hunt/dispatchHunt.ts`'s shape. Sequence exactly per the task
  brief: config check (before any DB work) → pool-budget gate (BYO-exempt)
  → 5/day counter (uniform, filtered on the literal `mode = 'tailor'`, not
  the deps' `mode` param — see judgment note below) → insert with
  unique-violation (`23505`) caught as `cooldown` → GitHub Actions
  `workflow_dispatch` POST to `hosted-tailor.yml` → on non-204, synchronous
  `UPDATE tailor_runs SET status='failed', error='dispatch failed (status
  <n>)'` via the admin client, then `dispatch_failed` → on 204, `ok`.
- `web/app/api/tailor/run/route.ts` — auth gate identical to
  `hunt/run/route.ts` (`getUser` → 401 → `isAdmin || hasClaimedInvite` →
  403), body validation (`posting_id` required/400, `mode` defaults to
  `"tailor"`/validated as one of the two allowed values/400), looks up
  `isByo`/`monthToDateSpend`/`budgetCap` via `getApiKeyInfo`/
  `getMonthToDateSpend`/`getBudgetCap` on the authed client, `dailyLimit =
  5`, `githubRepo`/`githubToken` from `GITHUB_REPO`/
  `GITHUB_DISPATCH_TOKEN`, then the exact `DispatchTailorResult` → HTTP
  switch from the brief (503/429×3/502/200).
- `web/lib/tailor/dispatchTailor.test.ts` — 10 tests mirroring
  `dispatchHunt.test.ts`'s structure (`fakeAdmin`, `baseDeps`, `FIXED_NOW`,
  real `Response` objects, no fake timers).

## Judgment calls made (both explicitly left open by the brief)

1. **Null template → GHA input**: send `template: ""` (never omit the key).
   Chosen for payload-shape uniformity and simpler test assertions; GitHub
   Actions `workflow_dispatch` string inputs reject `null`. Documented in a
   comment at the fetch call site.
2. **Daily-limit counter's `mode` filter**: the brief's step 3 literally
   reads `mode = 'tailor'` (a fixed string), not "the `mode` this call
   carries" — I implemented it as a hardcoded `.eq("mode", "tailor")`,
   independent of `deps.mode`. In practice this task's route only ever
   passes `mode: "tailor"` so the two are behaviorally identical today; the
   hardcoded version means a future `render` dispatch (if ever wired)
   wouldn't count against the tailor-generation daily cap. Documented in a
   comment above the count query. Flagging this explicitly in case the
   intent was actually "count whatever mode this call is" — the brief's
   literal wording is what I went with.

## Testing

- `npx vitest run lib/tailor/dispatchTailor.test.ts` — 10/10 passed.
- `npx tsc --noEmit` — clean (zero errors).
- `npm run lint` — zero errors/warnings in any file I touched (pre-existing
  errors/warnings in unrelated files, confirmed via `git status --short`
  showing only my 3 new files).
- `npm test` (full suite) — 100 files / 899 tests passed, including the new
  10.
- `bash scripts/scrub_gate.sh` — PASS.

### TDD evidence

RED: wrote `dispatchTailor.test.ts` importing `./dispatchTailor` before
that file existed.
```
FAIL  lib/tailor/dispatchTailor.test.ts [ lib/tailor/dispatchTailor.test.ts ]
Error: Cannot find module './dispatchTailor' imported from
'.../web/lib/tailor/dispatchTailor.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```

GREEN: after writing `dispatchTailor.ts`:
```
✓ lib/tailor/dispatchTailor.test.ts (10 tests) 5ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### Test cases covered

- not_configured (no fetch call, no `admin.from` call)
- budget_exceeded when spend ≥ cap and not BYO
- budget_exceeded skipped when BYO even if spend ≥ cap
- daily_limit at exactly 5 existing today-rows
- dispatches when count is one below the limit (boundary sanity check)
- cooldown on a unique-violation (`23505`) insert error, fetch never called
- non-unique-violation insert error throws (doesn't swallow real DB errors)
- ok on 204 with the exact documented dispatch payload shape asserted
- template `null` → sent as `""` in the GHA payload
- dispatch_failed on non-204, asserts the admin update was called with
  `{ status: "failed", error: "dispatch failed (status 500)" }`
- anti-leak `expect(JSON.stringify(result)).not.toContain("gh-secret-token")`
  on both the `ok` and `dispatch_failed` paths

## Files changed

- `web/lib/tailor/dispatchTailor.ts` (new)
- `web/lib/tailor/dispatchTailor.test.ts` (new)
- `web/app/api/tailor/run/route.ts` (new)

## Self-review findings

None outstanding. Verified against every numbered step in the brief's
dispatch sequence, the exact HTTP status mapping table, no
`NextResponse`/HTTP-mapping logic inside `dispatchTailor.ts`, no dead code,
no extra features (no admin "run for user" override — brief/route contract
doesn't call for one on tailor, unlike hunt), never-log-token discipline
verified by the anti-leak test assertions, ownership fence respected
(`web/lib/hunt/**` untouched — confirmed via `git status`).

## Concerns

Only the daily-limit `mode` literal-vs-variable judgment call above is
worth a second pair of eyes — it's a real behavioral fork, just one that's
unobservable under this task's actual usage (route only ever sends
`mode: "tailor"`). No blocking concerns.

Note: this report file previously contained an unrelated, stale report
("dossier change-log: parse learned-insights.md insight lines") — evidently
a leftover from a different task/worktree — overwritten with this task's
actual report.
