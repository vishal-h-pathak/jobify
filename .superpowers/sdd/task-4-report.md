# Task 4 report: SourceChip + ResumeView

## What was done

1. Read `.superpowers/sdd/task-4-brief.md` in full.
2. Verified prerequisite types (`ClaimUnit`, `NumberToken`, `SourceRef`) already exist in
   `web/components/tailor/types.ts` (from Task 2) and match the brief's expectations exactly —
   no redefinition needed.
3. Verified `web/components/ui/Card.tsx` exports `Card` with a `className` prop, as consumed by
   `ResumeView.tsx`.
4. Created `web/components/tailor/SourceChip.test.ts` verbatim from the brief (Step 1).
5. Created `web/components/tailor/ResumeView.test.ts` verbatim from the brief (Step 1).
6. Ran both new test files before implementation existed — confirmed both failed with
   "Cannot find module" errors (Step 2), as expected.
7. Created `web/components/tailor/SourceChip.tsx` verbatim from the brief (Step 3):
   `claimChipLabel`, `escapeRegExp`, `highlightNumbers`, and the `SourceChip` component
   (hover/focus-triggered quote popover).
8. Created `web/components/tailor/ResumeView.tsx` verbatim from the brief (Step 4):
   `groupResumeUnits` (id-regex-based grouping, never array-position-based), `BulletText`,
   `EditableClaim` (click-to-edit textarea, commits on blur/Enter, `onEdit` gates the affordance
   to text-bearing units only), and the `ResumeView` component.
9. Ran the two new test files — both pass (Step 5).
10. Ran `npx tsc --noEmit` — clean, no output.
11. Ran the full `npx vitest run` suite — 111 test files, 990 tests, all passing (nothing else
    broke).
12. Self-reviewed the diff against the brief line-by-line, with particular attention to the four
    id-parsing regexes:
    - `EXP_HEADER_RE = /^r\.exp(\d+)\.header$/`
    - `EXP_BULLET_RE = /^r\.exp(\d+)\.b(\d+)$/`
    - `EDU_RE = /^r\.edu(\d+)$/`
    - `SKILL_RE = /^r\.skill(\d+)$/`
    All four match the brief exactly, and the grouping logic derives experience/education/skill
    structure purely from `unit.id` regex captures — never from array position in a separate
    `tailored.json`. The defensive backstop (`.filter((g) => g.header !== null)`) drops any
    experience group whose header unit didn't survive claims-verification, even if orphan
    bullets for that index are still present.
13. Committed with the exact message specified in the brief.

## Test output — SourceChip.test.ts

```
 ✓ components/tailor/SourceChip.test.ts (8 tests) 2ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

## Test output — ResumeView.test.ts

```
 ✓ components/tailor/ResumeView.test.ts (6 tests) 2ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Both load-bearing correctness cases pass:
- "drops an experience whose header did not survive, even if a bullet unit is present (defensive
  backstop)" — `grouped.experience.map((e) => e.index)` equals `[0]`, confirming the orphan
  `r.exp1.b0` bullet (no matching `r.exp1.header`) does not produce a phantom experience group.
- "ignores cover-letter units entirely" — a `cl.s0` / `surface: "cover_letter"` unit does not
  leak into `experience` or `skills`.

## Full suite

```
 Test Files  111 passed (111)
      Tests  990 passed (990)
   Duration  3.62s
```

## tsc --noEmit

Clean — no output, exit 0.

## Commit

```
90ccb6e V3B-S3: source chips + resume viewer, id-parsed claim grouping
 4 files changed, 420 insertions(+)
 create mode 100644 web/components/tailor/ResumeView.test.ts
 create mode 100644 web/components/tailor/ResumeView.tsx
 create mode 100644 web/components/tailor/SourceChip.test.ts
 create mode 100644 web/components/tailor/SourceChip.tsx
```

## Concerns

None. All files were written verbatim from the brief (both test files and both implementation
files), types matched what Task 2 already shipped with zero drift, and every verification step
(fail-first, pass-after, tsc, full suite, regex self-review) came back clean.

Note: this file previously held a report from an earlier/different task-numbering pass of the
plan (materials-signing + `GET /api/tailor/materials/[runId]`, unrelated to this task's scope).
It has been overwritten with this task's report per the current brief.

## Addendum: code-review fix pass — test-coverage gaps in ResumeView.test.ts

Two Important findings from code review on the already-committed, approved
`groupResumeUnits` implementation (`web/components/tailor/ResumeView.tsx` unchanged):

1. The existing fixture always presented bullets in id-ascending array order, so a naive
   encounter-order implementation (no real regex-parse-and-sort) would have passed every
   existing test undetected.
2. No coverage for empty `units`, duplicate ids (Map-overwrite "last one wins" semantics),
   or a resume-surface unit whose id matches none of the four known patterns.

Added 4 new `it(...)` blocks to `web/components/tailor/ResumeView.test.ts` (no changes to
`ResumeView.tsx`):

- **id-order property**: fixture array `[b2, header, b0]` (b1 intentionally missing, simulating
  a verifier-dropped bullet; b2 placed before b0). Asserts
  `grouped.experience[0].bullets.map(b => b.id)` equals `["r.exp0.b0", "r.exp0.b2"]`. Verified by
  inspection that a naive push-in-encounter-order implementation would emit
  `["r.exp0.b2", "r.exp0.b0"]` instead — the real implementation's
  `.sort((a, b) => Number(EXP_BULLET_RE.exec(a.id)![2]) - Number(EXP_BULLET_RE.exec(b.id)![2]))`
  is what makes this assertion pass, so the test is a genuine regression guard against
  reverting to array-order.
- **empty array**: `groupResumeUnits([])` equals
  `{ experience: [], education: [], skills: [], summary: null }`.
- **duplicate id "last one wins"**: two `r.exp0.header` units with different `fields.org`;
  asserts `grouped.experience[0].header` is reference-equal to the second unit — documents the
  `Map`-keyed-by-parsed-index overwrite behavior as intentional.
- **unrecognized id pattern**: a `resume`-surface unit `id: "r.something.weird"` mixed into the
  existing fixture; asserts it appears in none of `experience`/`education`/`skills`/`summary`
  and doesn't disturb the other sections' contents.

### Test output

```
 RUN  v3.2.6 /Users/jarvis/dev/jarvis/jobify-wt/v3b-s3-ui/web

 ✓ components/tailor/ResumeView.test.ts (10 tests) 2ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### tsc --noEmit

Clean, no output.

### Commit

```
git add web/components/tailor/ResumeView.test.ts
git commit -m "V3B-S3: strengthen groupResumeUnits tests — id-order property, edge cases"
```
