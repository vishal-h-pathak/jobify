# Session 27 — ONB-C: Shell + design-system polish  (Onboarding-v2 wave 1, parallel with ONB-A)

**Model: Sonnet.** Spec = `planning/ONBOARDING_REDESIGN.md` §1 (diagnosis — read
it to understand WHY each change) and §3/§4-C (what to build). Implement
faithfully; no redesigning beyond the spec.
**Run from:** a `jobify-wt/hosted-onbv2-shell` worktree off main.
**You own:** `web/components/ui/Card.tsx`, `web/components/ui/Input.tsx` /
`TextArea`, `web/app/page.tsx`, `web/app/(app)/layout.tsx`,
`web/app/globals.css`, their tests. Do NOT touch `web/lib/**`,
`web/app/(app)/onboarding/**`, `web/app/api/**`, admin/settings/feed pages,
`jobify/`, migrations. (ONB-A owns lib+api in parallel — stay out.)

## Tasks (all from §3)

1. **Card variants:** `variant?: "default" | "quiet" | "elevated"` exactly as
   specced (quiet: borderless `bg-surface/50`; elevated: border +
   `shadow-lg shadow-black/20`). Default unchanged so every existing call site
   renders identically — zero visual regressions outside opted-in variants.
2. **TextArea autosize** up to ~8 rows; keep the global amber focus ring.
3. **Motion utilities** in globals.css: panel-enter (240ms ease-out,
   translateY(8px)→0 + fade), message-enter (180ms), plus a
   `prefers-reduced-motion` media query that disables both. Utility classes
   only — ONB-B applies them to the onboarding surface later.
4. **Landing page axis fix:** the 3 steps render as a visibly NUMBERED,
   properly aligned list (the current `flex flex-col` kills the `<ol>` markers
   — §1.8); CTA pair goes horizontal; keep all copy as-is except honest
   numbering.
5. **Width consistency (§1.9):** pick ONE content width for the app shell and
   onboarding (recommendation: shell adopts `max-w-2xl` on the onboarding
   route is NOT possible from your files — so standardize the shell at
   `max-w-3xl` and note in your report that ONB-B should set onboarding
   content to `max-w-3xl` to match). Document the decision in the code
   comment.
6. **Type ramp starts:** app-page h1s get `text-2xl` minimum (layout-level
   heading styles only; page-internal headings belong to their owners).
7. **The one flourish:** the radial amber glow utility
   (`color-mix(in srgb, var(--color-amber) 6%, transparent)`) as an opt-in
   class, unused for now (ONB-B applies it).

## Tests

Card variant class mapping (all three); default-variant snapshot of classes
unchanged; TextArea autosize behavior (rows grow, cap at ~8); landing renders
3 numbered steps; reduced-motion query present in emitted css (string assert
is fine); existing ui tests all stay green.

## Exit criteria

`npm run build` + vitest + tsc green; scrub gate PASS; diff inside ownership.
Commit: `ONB-C: Card variants, TextArea autosize, motion utilities, landing axis + width fixes`.
Push; do NOT merge — review-then-merge.
