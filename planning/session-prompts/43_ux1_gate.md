# Session 43 — UX1-A: the intake gate  (UX-1, parallel with 44)

**Model: Sonnet.** Spec = `planning/UX1_DESIGN.md` §1–2, §4 — read FIRST. Owner
directive, verbatim: "the profile must be built before the rest of the site is
even accessible." Field evidence: the owner completed the anchor, navigated
away, and could not find his way back — build the funnel that makes that
impossible.
**Branch:** `feat/ux1-gate` off main, worktree `jobify-wt/ux1-gate`.
**You own:** the completion helper (new, `web/lib/onboarding/intakeComplete.ts`),
`web/app/(app)/layout.tsx` + `web/app/(app)/NavLinks.tsx` (guard + nav states),
`web/app/page.tsx` (signed-in redirect), the welcome-back line on
`web/app/(app)/onboarding/page.tsx` (additive — do NOT restructure the intake),
empty-state copy on feed / tailor index / settings pages, tests. Do NOT touch:
api routes, `web/lib/submit|tailor|crypto/**`, migrations, `jobify/`, the
dossier page (44's).

## PINNED CONTRACT (shared with session 44)
```ts
// web/lib/onboarding/intakeComplete.ts — THE one completion source of truth:
// onboarding_sessions.status === 'complete' for this user; nothing else.
export async function intakeComplete(
  supabase: SupabaseClient<Database>, userId: string
): Promise<boolean>;
```

## Build
1. **Helper** per the pinned contract (`.maybeSingle()`; no row → false).
2. **Layout guard (server-side, `(app)/layout.tsx`):** signed-in + incomplete +
   pathname not under `/onboarding` → `redirect("/onboarding")`. One session
   read per request; reuse the layout's existing user load. API routes keep
   their own guards — this is pages only.
3. **Nav states:** incomplete → brand + "Your intake" (with live "N of 12"
   module progress from the modules jsonb — reuse the registry's ordering, no
   new endpoint if the layout already has the session row) + Sign out; admins
   also keep Admin. Complete → today's full nav, unchanged.
4. **Landing `/`:** signed-in + incomplete → `/onboarding`; signed-in +
   complete → `/feed`; signed-out → unchanged.
5. **Welcome-back line:** on `/onboarding` when `updated_at` is >30 min stale:
   "Welcome back — picking up at <module label>." over the PhaseRail. Additive.
6. **Empty states (§4):** feed zero-match, tailor index empty, settings
   pre-resume — one honest orienting line + one action each; match the voice
   (direct, warm, zero exclamation marks).

## Tests
Guard matrix (incomplete × each gated route → redirect; complete → renders;
`/onboarding` never redirects; admin sees Admin in both states); nav render
states; landing redirects; helper (no row / in_progress / complete);
welcome-back stale-threshold logic as a pure function. Full web suite green.

## Exit criteria
Web vitest + tsc + build green; scrub gate PASS; diff inside ownership.
Commit: `UX1-A: intake gate — completion helper, route guard, nav states,
empty states`. Push; do NOT merge.
