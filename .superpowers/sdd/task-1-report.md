# Task 1 report — `tailor_runs` additive Supabase type + shared TS shapes

## What was implemented

1. **`web/lib/supabase/types.ts`** — added a `tailor_runs` entry to
   `Database.public.Tables`, inserted immediately after `posting_reactions`
   (the prior last table) and before the closing `Tables` brace / `Views`
   key. Header comment follows the `hunt_cycles` / `posting_reactions`
   style (migration tag, ownership note, RLS summary).
   - `Row`: every column from the SQL, nullability matched exactly
     (`template`, `feedback`, `doc_sha256`, `dropped_count`, `error`,
     `cost_usd` nullable; everything else non-null, including `created_at`/
     `updated_at` — following this file's existing convention of typing
     `DEFAULT now()` timestamp columns as non-null `string`, same as every
     other table here). `status` and `mode` are string-literal unions
     matching the CHECK constraints. `progress` is
     `Array<{ step: string; label: string; at: string }>`.
   - `Insert`: only `user_id`, `posting_id`, `mode?`, `template?` — the
     columns the web route actually inserts (status/progress/etc. have DB
     defaults; id/created_at/updated_at are server-generated). Leading
     comment notes service-role-only INSERT per the SQL's RLS comment.
   - `Update`: all mutable columns typed as optional (`status?`, `mode?`,
     `template?`, `feedback?`, `progress?`, `doc_sha256?`, `dropped_count?`,
     `error?`, `cost_usd?`, `updated_at?`) since `Database` is shared with
     the worker's broader write surface, per the brief's explicit
     instruction — with a comment noting the web side itself only ever
     writes `status`/`error`/`updated_at` (stale-reap + dispatch-failure
     paths).
   - `Relationships: []`, matching every other table.

2. **`web/lib/tailor/types.ts`** (new file) — exports a plain `TailorRun`
   interface mirroring the `Row` shape. Checked for an existing
   `web/lib/*/types.ts` convention first (`web/lib/hunt/`,
   `web/lib/onboarding/`) — found none; every existing subtree defines its
   types inline in its own module (e.g. `dispatchHunt.ts` exports
   `DispatchHuntResult`/`DispatchHuntDeps` directly), so per the brief's
   fallback instruction this is a plain exported interface with no
   re-derivation magic, with a doc comment pointing back at the Supabase
   `Row` type as the source of truth to keep in sync by hand.

## What was verified

- `npx tsc --noEmit` from `web/`: clean, exit code 0, no output.
- `npx eslint lib/supabase/types.ts lib/tailor/types.ts`: clean, no output.
- `git diff --stat`: only `web/lib/supabase/types.ts` modified (51
  insertions, 0 deletions — purely additive) plus the new
  `web/lib/tailor/` directory; no other table entry touched.

## Files changed

- `web/lib/supabase/types.ts` — added `tailor_runs` table entry.
- `web/lib/tailor/types.ts` (new) — `TailorRun` interface.

## Self-review findings

- Completeness: all 13 SQL columns present in `Row`; nullability checked
  column-by-column against the SQL block in the brief.
- Convention match: comment style/placement mirrors `hunt_cycles` (worker-
  written, read-only-from-web pattern for the RLS note) and
  `posting_reactions` (most recent table, closest physical neighbor).
- Discipline: no other table entry touched; no extra fields added beyond
  the SQL; `Insert`/`Update` scoped exactly as the brief specified.
- `npx tsc --noEmit` clean.

## Issues or concerns

None. This was a straightforward additive, mechanical task with no
ambiguity once the SQL block and the two analog tables were read.
