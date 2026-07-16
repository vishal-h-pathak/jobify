# Session 38 — V3B-S3: The tailor surface  (V3b wave 2, single session, after S1+S2 merge)

**Model: Sonnet.** Spec = `planning/V3B_DESIGN.md` §UX — read FIRST; follow
its layout/type/motion calls exactly (same design language as the dossier).
**Branch:** `feat/v3b-s3-ui` off main (launcher enforces S1+S2 merged),
worktree `jobify-wt/v3b-s3-ui`.
**You own:** `web/app/(app)/feed/**` (the "Tailor this" entry point on match
cards + a Materials affordance), `web/app/(app)/tailor/**` (new viewer
route), `web/components/tailor/**` (new), tests. Consume S2's
`web/lib/tailor/**` and API routes — do NOT modify them, or `jobify/`,
onboarding, dossier, settings, migrations.

## Build (per V3B_DESIGN §UX — condensed)
1. **Entry point:** "Tailor this" on match cards (saved + new states);
   already-tailored matches show "Materials" instead, linking to the viewer.
   Cooldown/count errors surface as honest inline copy with the retry time.
2. **Generating state:** the ~2–4 min wait designed honestly — status from
   the polling route, staged copy ("reading the posting…", "drafting
   against your profile…"), never a fake progress bar; resumable (leave and
   return via the Materials link).
3. **The viewer** (`/tailor/[runId]`): side-by-side resume (left) and cover
   letter (right) rendered from claims.json; every sourced unit hoverable →
   source chip ("from your resume, line …" / "from your range answers")
   with the quoted span; `voice`-tagged units styled as style (muted chip,
   no source); **the honesty drawer** — collapsed list of dropped units
   with reasons ("number not in your confirmed metrics"), always present
   when non-empty, never hidden.
4. **Actions:** template switcher (the 5 ATS-safe templates; triggers S1's
   zero-LLM `mode=render`), PDF downloads via S2's signed-URL route,
   copyable CL text, inline edit per the design (user-edited units marked
   "yours" — exempt from sourcing, visually distinct), regenerate (full
   re-run, subject to cooldown, confirm dialog states the cost honestly).
5. **Empty/error states:** failed runs show the worker's error + retry;
   materials for a deleted posting still render (claims.json is
   self-contained).

## Tests
Entry-point state matrix (tailorable / generating / materials / cooldown);
viewer renders sourced vs voice vs user-edited units distinctly from a
claims.json fixture; honesty drawer lists dropped units; template switch
calls mode=render (spy, no LLM route); signed-URL fetch wiring; failed-run
surface. Repo's node-env conventions (pure helpers + direct invocation).

## Exit criteria
Web vitest + tsc + build green; scrub gate PASS; diff inside ownership.
Commit: `V3B-S3: tailor surface — side-by-side viewer, source chips, honesty drawer, template switch`.
Push; do NOT merge. Reviewer close-out: apply 0012 live if not yet, verify
the job-materials bucket exists on the live project, `vercel --prod`, and a
real end-to-end tailor on a live match.
