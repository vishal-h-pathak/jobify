# Session 44 — UX1-B: the portable dossier + paper cuts  (UX-1, parallel with 43)

**Model: Sonnet.** Spec = `planning/UX1_DESIGN.md` §3 — read FIRST. Owner
directive (D5), verbatim intent: the dossier is a deliverable users can leave
with — "a document they can save and continue to use to refine how they use
other similar AI tools for their job search," whether or not they ever run a
jobify hunt.
**Branch:** `feat/ux1-dossier-export`, worktree `jobify-wt/ux1-dossier-export`.
**You own:** `web/app/api/profile/export/route.ts` (new),
`web/lib/dossier/exportMarkdown.ts` (new), the affordance row on the dossier
page (`web/components/dossier/**` additive + `web/app/(app)/profile/` wiring),
the dossier print stylesheet, plus two parked paper cuts (below), tests. Do NOT
touch: the layout/nav/landing (43's), api routes other than the new export,
migrations, `jobify/`.

## PINNED CONTRACT (shared with session 43)
Session 43 ships `web/lib/onboarding/intakeComplete.ts`
(`intakeComplete(supabase, userId): Promise<boolean>`). Your export route gates
on it — code against the signature; integration verified at the reviewer's
merge (test with a local mock).

## Build
1. **`exportMarkdown.ts`** — pure renderer over the SAME `derive.ts` output the
   dossier page consumes (import and reuse; never re-derive from the doc):
   identity header (name + the one-line professional summary), the three layers
   (facts / wants / texture) as scannable sections, confirmed metrics verbatim,
   voice notes, the change-log tail (last ~5 entries), provenance footer:
   "Generated from my jobify profile, <date>. Every line traces to my own
   words." Clean CommonMark, no HTML, reads beautifully raw AND rendered.
2. **`GET /api/profile/export?format=md`** — auth + invite-or-admin gate (house
   pattern) + `intakeComplete` gate (409 `{error:"intake_incomplete"}` before
   completion); responds `text/markdown` with
   `Content-Disposition: attachment; filename="dossier-<first>-<YYYY-MM-DD>.md"`.
   **Constitution test (required): the export NEVER touches
   `application_profiles`** — work-auth/self-ID/contact defaults stay out of
   every export by construction; assert the admin client is never asked for
   that table.
3. **The affordance row** on the dossier page — "Your dossier, yours to keep":
   Download (.md) · **Copy for AI tools** (clipboard: instruction header —
   "This is my verified professional profile — my background, values, working
   style, and confirmed metrics, in my own words. Use it as ground truth when
   helping me with job-search tasks." — followed by the same markdown) · Print
   (window.print + a print stylesheet scoped with the kit's `body:has()`
   pattern so the dossier prints as a clean typographic one-pager).
4. **Paper cut 1:** delete the dead `"identity"` stage literal from
   `web/lib/supabase/types.ts`'s `onboarding_sessions.stage` unions AND
   `InterviewStage` in `web/lib/anthropic/interview.ts` + the `"identity"`
   case in `web/lib/onboarding/handleTurn.ts` (audit finding: the live DB CHECK
   rejects it — `anchor|calibration|resume|targeting|done` is the legal set;
   migration 0010 remapped all historical rows). Chase the type errors until
   tsc is clean — that's the point of the cleanup.
5. **Paper cut 2:** in-flight guard on the kit's "I applied" button
   (`web/components/submit/SubmitKit.tsx`): disable while the markApplied call
   is pending so a double-click can't double-fire.

## Tests
exportMarkdown golden test (full + sparse dossier fixtures — render-what-
exists, no invented lines); route: 401/403/409-incomplete/200 headers +
filename; the never-touches-application_profiles constitution assertion;
copy-block content = header + markdown exactly; applied-button pending state;
types cleanup: suite + tsc green with the literal gone. Alex Quinn fixtures.

## Exit criteria
Web vitest + tsc + build green; scrub gate PASS; diff inside ownership.
Commit: `UX1-B: dossier export (md + AI-ready copy + print) + stage-literal
and applied-guard paper cuts`. Push; do NOT merge.
