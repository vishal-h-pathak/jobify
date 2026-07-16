# Task 2 report — dossier change-log: parse learned-insights.md insight lines

## What I implemented

In `web/lib/dossier/derive.ts`:

1. Widened `ChangeLogEvent.moduleKey` from `ModuleKey` to `ModuleKey | \`learning-${number}\`` (a
   template-literal type). `moduleRegistry.ts`'s `ModuleKey` union was not touched.
2. Added `INSIGHT_LINE_RE` and `deriveInsightEvents(learnedInsightsMd: string): ChangeLogEvent[]`,
   exactly per the brief: splits on `\n`, regex-matches `^- (\d{4}-\d{2}-\d{2}): (.+)$` against each
   trimmed line, filters non-matches, and maps each match to a `ChangeLogEvent` with
   `label = "${formatMonthDay(date+midnight-UTC)} — ${text}"`, `moduleKey = "learning-${i}"`,
   `completedAt = "${date}T00:00:00.000Z"`. The `<!-- last-processed: ... -->` watermark line never
   matches the regex, so it's dropped with no special-casing. The text after `: ` is passed through
   verbatim — never re-derived or reformatted.
3. Changed `deriveEvents(modules, learnedInsightsMd)` to take the raw markdown string as a second
   param, kept the existing module-completion `.map()` body byte-identical (just de-inlined from the
   chained `.sort()`), and merged `[...moduleEvents, ...deriveInsightEvents(learnedInsightsMd)]` before
   sorting ascending by `completedAt.localeCompare`.
4. Updated the one call site in `deriveDossier`: `events: deriveEvents(modules, doc["learned-insights.md"] ?? "")`.
   No change to `DerivedDossierInput` — `doc` already carries this key (confirmed via
   `buildMinimalDoc`/`emptyDoc` in `incrementalDoc.ts`, which seeds every `DOC_FILENAMES` key,
   including `"learned-insights.md"`, to `""`).

In `web/lib/dossier/derive.test.ts`, added a new `describe("deriveDossier — learned-insights.md
change-log rows", ...)` block with three tests:
- **Parsing**: a watermark line + 2 dated bullets → 2 events, `moduleKey` `"learning-0"`/`"learning-1"`,
  labels in `"Mon Day — <text>"` shape, watermark produces no event.
- **Empty state preserved**: rebuilds the phase-1-only 4-module fixture with
  `"learned-insights.md": ""` → `dossier.events` still has length 4 (this is a fresh, equivalent
  assertion alongside the pre-existing one at derive.test.ts:277-279, which I left untouched and
  unweakened).
- **Interleaving**: 2 completed modules (Jul 10, Jul 15) + 3 insight lines (Jul 09, Jul 12, Jul 16)
  → asserts the exact `moduleKey` order: `["learning-0", "anchor", "learning-1", "values",
  "learning-2"]`, proving strict chronological interleaving of both row kinds.

## Test commands run and output

```
$ cd web && npx vitest run lib/dossier/derive.test.ts
 ✓ lib/dossier/derive.test.ts (27 tests) 3ms
 Test Files  1 passed (1)
      Tests  27 passed (27)
```
(Note: `web/node_modules` was not yet installed in this worktree; ran `npm install` first — no
package.json/lockfile changes, node_modules is gitignored.)

```
$ cd web && npx tsc --noEmit
(no output — clean)
```

## Files changed

- `/Users/jarvis/dev/jarvis/jobify-wt/liv1-learning/web/lib/dossier/derive.ts`
- `/Users/jarvis/dev/jarvis/jobify-wt/liv1-learning/web/lib/dossier/derive.test.ts`

Commit: `89d6fee` — "LIV-1 task 2: dossier change-log — parse learned-insights.md insight lines"

## Self-review findings

- Regex/parsing/merge logic matches the brief's exact code, including the "byte-identical map body"
  note for the module-completion branch.
- The pre-existing "phase-1-only profile has exactly 4 change-log events" test
  (`derive.test.ts:277-279`) was left completely unmodified and still passes.
- `tsc --noEmit` is clean with the widened `ChangeLogEvent.moduleKey` type across the whole `web/`
  project (confirms `ChangeLog.tsx`'s `key={event.moduleKey}` usage is satisfied without editing
  that file — React's `key` prop accepts any string, and the template-literal type is a subtype of
  `string`).
- Confirmed via `git diff --stat` that `web/components/dossier/ChangeLog.tsx` and
  `web/lib/onboarding/moduleRegistry.ts` have zero diff — neither was touched.
- Scrub gate: all test fixture text is generic placeholder text lifted from the plan's own example
  ("agency work", "platform ownership", "unpaid overtime") — no operator-identifying strings.

## Concerns

- None. One pre-existing, pre-task uncommitted change (`.superpowers/sdd/task-1-report.md`) and one
  untracked file (`docs/superpowers/plans/2026-07-16-liv1-learning.md`) were present in the working
  tree before I started and are unrelated to Task 2 — I did not stage or commit them.
- `.superpowers/sdd/task-2-report.md` (this file) previously contained an unrelated report from a
  different task/project ("Global discovery + embeddings (H4 hosted worker)"), evidently a stray
  leftover in this worktree — overwritten with this task's actual report.
