# Task 4 report — `web/lib/materials/` + `GET /api/tailor/materials/[runId]`

## What I implemented

- `web/lib/materials/signMaterials.ts`: `signMaterials(admin, userId, postingId, expiresInSeconds)`.
  Lists `job-materials/{userId}/{postingId}/` via `admin.storage.from("job-materials").list(prefix)`,
  intersects the listing against a `KNOWN_ARTIFACTS` constant (`resume.pdf`, `cover_letter.pdf`,
  `cover_letter.txt`, `tailored.json`, `claims.json`, `render_meta.json` — the exact §1.4 set),
  then makes **one batched** `createSignedUrls()` call for whatever's present and returns
  `{ filename: signedUrl }`. Bucket name `"job-materials"` is hardcoded (verified there's no
  existing shared bucket-name constant anywhere under `web/lib/` before adding this — matches
  `jobify/shared/storage.py::BUCKET`). Returns `{}` without ever calling `createSignedUrls` when
  nothing recognized is listed.

- `web/app/api/tailor/materials/[runId]/route.ts`: `GET` handler.
  1. Auth gate mirrors `web/app/api/hunt/run/route.ts:20-32` exactly.
  2. Ownership check is a **single query**: `.from("tailor_runs").select("user_id, posting_id,
     status").eq("id", runId).eq("user_id", user.id).maybeSingle()` — a row that doesn't exist and
     a row belonging to someone else both come back `null` from the same query, so they're
     structurally indistinguishable before the route even branches on it.
  3. `!run || run.status !== "succeeded"` → identical `404 { error: "not found" }` for both
     "doesn't exist" and "not ready yet."
  4. `signMaterials(admin, run.user_id, run.posting_id, SIGNED_URL_EXPIRY_SECONDS)` —
     `SIGNED_URL_EXPIRY_SECONDS = 300` is a named module-level constant, referenced once.
  5. `NextResponse.json({ urls })`.

  Dynamic route params: `{ params }: { params: Promise<{ runId: string }> }`, `const { runId } =
  await params` — matches `web/app/api/onboarding/modules/[key]/route.ts:28` exactly.

## What I tested and results

- `web/lib/materials/signMaterials.test.ts` (9 tests): exact prefix passed to `.list()`; `{}` +
  no `createSignedUrls` call when the listing is empty or has only unrecognized filenames; only
  present known artifacts get signed, in one batched call (asserted both a 2-of-6 subset and all
  6 present); a signed entry with a null `path` or null `signedUrl` is skipped rather than
  crashing; `expiresInSeconds` passed through verbatim; `list()` and `createSignedUrls()` errors
  both propagate (thrown, not swallowed).

- `web/app/api/tailor/materials/[runId]/route.test.ts` (11 tests): 401 unauthenticated; 403 no
  invite (non-admin); dynamic params correctly awaited (asserted the `eq("id", ...)` call
  receives the resolved `runId`); 404 for a nonexistent run; 404 for a different user's run,
  explicitly asserting the query is scoped by `user_id` too (no user-enumeration signal); 404 for
  `queued`/`failed`/`running` runs (`signMaterials` never called in any 404 case); 200 with the
  exact URLs `signMaterials` returned, and `signMaterials` called with the 300-second constant;
  admin bypasses the invite gate; a SELECT error throws rather than being swallowed.

- Full verification from `web/`: `npx tsc --noEmit` clean. `npm run lint` — zero errors/warnings
  in any file this task touched (`npx eslint` scoped to the four new files: clean); the 5
  pre-existing errors + 29 warnings elsewhere in the repo are untouched by this task and were
  present before it. `npm test`: **935 passed / 935** across 104 files (20 of them new to this
  task). `bash scripts/scrub_gate.sh` from repo root: PASS (no forbidden identifiers, no stray
  tracked binaries).

## TDD Evidence: RED and GREEN

For both new source files, I wrote the real test file first, then temporarily replaced the
implementation with a stub, ran the suite to capture a genuine failure, then restored the real
implementation and reran for green.

**RED — `signMaterials.test.ts` against a stub that always returns `{}`:**
```
 Test Files  1 failed (1)
      Tests  6 failed | 3 passed (9)
```
(6 failures: wrong `{}` results where signed URLs were expected, and the two error-propagation
tests found the stub doesn't throw.)

**RED — `route.test.ts` against a stub `GET` that always returns `{ urls: {} }` with no auth/DB
logic:**
```
 Test Files  1 failed (1)
      Tests  10 failed | 1 passed (11)
```
(Only the params-await test passed by coincidence; everything auth/ownership/status/signing
-related failed.)

**GREEN — after restoring the real implementations:**
```
 ✓ lib/materials/signMaterials.test.ts (9 tests) 3ms
 ✓ app/api/tailor/materials/[runId]/route.test.ts (11 tests) 5ms

 Test Files  2 passed (2)
      Tests  20 passed (20)
```

## Files changed

- `web/lib/materials/signMaterials.ts` (new)
- `web/lib/materials/signMaterials.test.ts` (new)
- `web/app/api/tailor/materials/[runId]/route.ts` (new)
- `web/app/api/tailor/materials/[runId]/route.test.ts` (new)

Commit: `951a644` — "feat(web): signed-URL materials read for tailor runs"

## Self-review findings

Checked every item from the task brief's self-review list; no issues found:

- Ownership check is one query filtering both `id` and `user_id` (not fetch-then-compare).
  Verified the HTTP response is identical (`404 { error: "not found" }`) for both "doesn't
  exist" and "exists but isn't yours" — same code path, same status, same body, since the
  underlying query returns `null` in both cases.
- `status !== "succeeded"` (covering `queued`/`running`/`failed`) → 404, same shape as not-found.
- Only artifacts present in storage get signed URLs — cross-checked `KNOWN_ARTIFACTS` character-
  for-character against the six-file list in `V3B_DESIGN.md` §1.4.
- `SIGNED_URL_EXPIRY_SECONDS = 300` is a single named constant referenced once at the call site
  (never a bare `300` repeated elsewhere in either file).
- Dynamic route params: `Promise<{ runId: string }>` + `await params`, matching the pinned
  pattern.

One judgment call worth flagging explicitly (not a defect, just noting the choice): the route
does **not** give admins a bypass on the ownership filter — even an admin's request for a run
they don't own gets 404, unlike `POST /api/hunt/run`'s admin-`userId`-override affordance. The
brief's wording ("filtered by both `id = runId` AND `user_id = user.id`... not a separate
ownership check") reads as unconditional, so I followed it literally rather than assuming an
implicit admin carve-out the brief never mentioned. If an admin "view any user's materials" path
is wanted later, it needs its own explicit judgment call.

## Issues or concerns

None. `@supabase/supabase-js`'s `createSignedUrls` return shape was verified directly against
`node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts` (no `.d.ts` files ship in this
version — the package ships type-annotated `.ts` sources compiled at build time) rather than
assumed: `{ data: { error, path, signedUrl }[], error } | { data: null, error }`. Note the field
is `signedUrl` (lowercase `u`), not `signedURL` — the legacy Python SDK's `get_signed_url` checks
three casings defensively; the current JS client's typed return only has `signedUrl`, so no such
defensiveness was needed here.
