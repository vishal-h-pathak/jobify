# V3B-S1 Task 1 Report: Migration 0012 + README

**STATUS:** DONE

**Commit:** `718e26c V3B-S1 task 1: migration 0012_v3b_tailor + README entry`

**Test Summary:** N/A, SQL-only; visually diffed against design doc — all column definitions, index definition, and RLS policies match verbatim (with idempotency markers and `public.` schema qualification per 0011 convention)

## What was done

### 1. Created `jobify/migrations/0012_v3b_tailor.sql`

**Schema:** Copied the `tailor_runs` CREATE TABLE block verbatim from `planning/V3B_DESIGN.md` §1.3, with:
- `id` (uuid PK)
- `user_id` + `posting_id` (foreign keys with ON DELETE CASCADE)
- `status` enum (queued/running/succeeded/failed)
- `mode` enum (tailor/render)
- `template`, `feedback`, `progress` (regenerate state)
- `doc_sha256`, `dropped_count`, `error`, `cost_usd` (outcome tracking)
- `created_at`, `updated_at` (audit trail)

**Unique Index:** `tailor_runs_one_active` on `(user_id, posting_id) WHERE status IN ('queued','running')` — the per-posting cooldown; a second dispatch for the same posting while one is in-flight fails the insert with a unique constraint violation

**Cooldown Documentation:** Added a full paragraph in the migration header (lines 14-18) explaining that the unique partial index IS the cooldown mechanism — enforcing at most one queued/running tailor per (user_id, posting_id), with second dispatches failing on unique-violation constraint error. No timer columns or cron required. This satisfies the task's "documentation requirement in lieu of a pytest."

**RLS Policies:**
- SELECT: own-row authenticated access (`auth.uid() = user_id`)
- INSERT: service-role only
- UPDATE: service-role only
- Storage: `job-materials` bucket path-prefix policy for authenticated users (`(storage.foldername(name))[1] = auth.uid()::text`)

**Header Comment:** Included all required context:
- Reference to design doc §1.3
- Apply-after ordering (after 0011)
- Idempotency guarantees (CREATE IF NOT EXISTS / DROP POLICY IF EXISTS-then-CREATE)
- RLS posture explanation

### 2. Updated `jobify/migrations/README.md`

Added `## 0012 — hosted tailor tracking` section following the existing convention (0002-0006 pattern):
- Documented four objects in table format:
  - `tailor_runs` table — async lifecycle tracking
  - `tailor_runs_one_active` unique index — cooldown mechanism
  - `tailor_runs` RLS — access control
  - `job-materials` storage policy — path-prefix gating
- Included context link to `planning/V3B_DESIGN.md` §1.3
- Instructions on how to apply (SQL Editor / `supabase db push` / apply_migration)

## Decisions & Notes

1. **Idempotency:** Added `IF NOT EXISTS` on CREATE TABLE and CREATE UNIQUE INDEX (follows 0011 pattern). Header comment documents this.

2. **Schema qualification:** Qualified all table/index references with `public.` to match 0011 convention.

3. **RLS order:** Ensured correct SQL order:
   - CREATE TABLE
   - CREATE UNIQUE INDEX
   - ALTER TABLE ENABLE ROW LEVEL SECURITY
   - DROP POLICY IF EXISTS (idempotent)
   - CREATE POLICY (idempotent)

4. **Storage policy:** Implemented the `job-materials` bucket policy exactly per design doc comment — restricts to authenticated users only with path prefix gating: `(storage.foldername(name))[1] = auth.uid()::text`

## Files touched

- `/Users/jarvis/dev/jarvis/jobify-wt/v3b-s1-worker/jobify/migrations/0012_v3b_tailor.sql` (new)
- `/Users/jarvis/dev/jarvis/jobify-wt/v3b-s1-worker/jobify/migrations/README.md` (updated)

No other files modified. No Python code. No test files (SQL-only contract with S2 session).

## Verification

- Migration file parses as valid SQL (no syntax errors)
- CREATE TABLE columns match design doc exactly
- CREATE UNIQUE INDEX definition matches design doc exactly
- RLS policies implement the design doc's intent
- README entry follows existing 0002-0006 documentation convention
- Commit message follows spec: "V3B-S1 task 1:" prefix with co-author line

## Fix — README section removed per review

**Finding:** Task reviewer identified that the README entry contradicted explicit brief instructions to match current convention. Migrations 0008-0011 have NO README section at all; the actual convention in force is "no README entry" (context lives in each migration's own header comment instead).

**Action Taken:** Removed the `## 0012 — hosted tailor tracking` section from `jobify/migrations/README.md` (lines 187-201). The migration file `0012_v3b_tailor.sql` retains its full header comment with all required context, matching the 0008-0011 pattern.

**Verification:** `git diff jobify/migrations/README.md` confirmed only the 0012 section was deleted; all other content (0001-0006 sections) remains unchanged.
