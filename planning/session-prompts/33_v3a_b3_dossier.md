# Session 33 — V3A-B3: The dossier  (V3a wave 2, parallel with 32)

**Model: Sonnet.** Spec = `planning/V3A_DESIGN.md` §3 (dossier) — read FIRST,
plus `PRODUCT_VISION.md` §1. This page is the app's visual ceiling — follow
the design's type-scale/amber/motion calls exactly; do not improvise new
visual language.
**Branch discipline:** worktree `jobify-wt/v3a-b3-dossier`, branch
`feat/v3a-b3-dossier` **off `feat/v3a`**. Push; reviewer merges.
**You own:** `web/app/(app)/profile/**` (new route), `web/lib/dossier/**`
(new), `web/app/(app)/layout.tsx` (nav link ONLY: Feed · Profile · Settings
[· Admin]), tests. Do NOT touch `web/app/(app)/onboarding/**` (32's),
`web/lib/onboarding/**` (frozen), `web/lib/anthropic/**`, feed/settings/
admin pages, `jobify/`, migrations.

## Build (per V3A_DESIGN §3 — condensed)
1. **`web/lib/dossier/derive.ts`** — pure mapper: (profiles row, modules
   state, extracted) → the dossier view model: FACTS / WANTS / TEXTURE bands,
   per-section source attribution (which module produced it), completeness
   (which of the 12 modules are done), validation surface (plain-words from
   `validation_status`). No migration, no new tables — everything derives.
   Exhaustive unit tests: full profile, checkpoint-minimal profile, missing
   modules, invalid profile.
2. **`/profile` route** — the flagship page: text-5xl name/header moment,
   the mirror narrative slot (renders the thesis intro when present — B2
   ships the mirror writer later; until then the design's "your story is
   still being written" placeholder), the three bands with the design's
   layout/type/amber specs, **source chips** on every section ("from your
   range answers") deep-linking to `/onboarding` at that module ("Redo this
   module" per the design's edit rule: typed fields inline-editable,
   derived fields redo-via-module), the change-log stub pattern (shaped for
   wave-3 events, renders "learning starts after your first hunts" until
   data exists), validation banners.
3. **Inline edits** (typed fields only, per the design's one-sentence rule):
   comp floor, location/remote — PATCH through a small authed route in your
   ownership (`web/app/api/profile/route.ts`) that updates extracted +
   re-applies the module writer via wave-1's `applyModuleToDoc` import
   (consume only), then revalidates.
4. **Empty state:** no profiles row → warm redirect to `/onboarding` (never
   a broken page).

## Tests
derive.ts matrix (above); source-chip → module deep-link mapping; inline-
edit PATCH gate (401/403), write path, revalidation; empty-state redirect;
nav shows Profile for authed users. Scrub gate (no operator strings; test
personas only).

## Exit criteria
Full web vitest + tsc + build green; scrub gate PASS; diff inside ownership.
Commit: `V3A-B3: the dossier — /profile flagship page, derive mapper, source-chip traceability, inline edits`.
Push; do NOT merge.
