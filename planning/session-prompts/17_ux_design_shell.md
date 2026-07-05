# Session 17 — UX-1: Design system + app shell  (Hosted wave 5a — run FIRST, alone)

**Model: Sonnet.** This prompt makes every design decision for you — implement
it faithfully rather than inventing alternatives.
**Run from:** a `jobify-wt/hosted-ux1-shell` worktree.
**Depends on:** wave 4 merged (H7a + fixes on main).
**Parallel-safe with:** nothing — you own the design system everyone else
consumes. Sessions 18/19 start only after this merges.
**You own:** `web/app/globals.css`, `web/tailwind.config.*` (if present),
`web/components/ui/**` (new), `web/app/(app)/layout.tsx`, `web/app/layout.tsx`,
`web/components/feed/**` (restyle only), `web/app/(app)/settings/**` (restyle
only). Do NOT touch `web/lib/**` logic, API routes, `jobify/`, `dashboard/`.

---

## Why

The app works end-to-end but looks like an unstyled wireframe (screenshot
review 2026-07-04: black void, browser-default file input, no branding, no
warmth). Friends test it this week. This session gives it a face; 18/19 build
their pages on your components.

## Design spec (decided — implement, don't redesign)

- **Name on screen:** "jobify" — lowercase wordmark, `font-semibold
  tracking-tight`, with a small amber dot after it (`jobify.`) as the only
  logo mark. No images, no icon fonts, no personal identifiers (CI has a
  scrub gate — never write the operator's name/domains into web/).
- **Palette (extend Tailwind theme in globals.css `@theme` or config):**
  - bg base `#0B0E14` (near-black blue), raised surface `#131722`,
    border `#232937`.
  - text primary `#E6E9F0`, secondary `#8A93A6`.
  - accent amber `#F5A97F`→ use `#E8956A` for hover; success `#7FBF7F`;
    danger `#D97A7A`.
  - Score badge tiers: ≥0.75 amber, 0.5–0.75 muted blue `#7A9BD9`, <0.5
    neutral gray.
- **Type:** keep Geist. Page titles `text-2xl font-semibold`, body
  `text-[15px] leading-relaxed`. Generous whitespace: page container
  `max-w-2xl mx-auto px-6 py-12` (feed: `max-w-3xl`).
- **Tone of ALL copy:** warm, direct, second person, no exclamation marks,
  no corporate filler. Example register: "You're in. Let's figure out what
  you're looking for." — that's the voice.

## Tasks

1. **Tokens + base styles** in `globals.css`: the palette above as CSS
   variables/Tailwind theme extensions; base body colors; focus rings
   (`ring-2` amber at 40% opacity); selection color; smooth color
   transitions on interactive elements (150ms).
2. **`web/components/ui/`** — small, dependency-free primitives, plain
   Tailwind + the tokens (NO component library, NO new npm deps):
   `Button.tsx` (primary amber / secondary surface+border / ghost, all with
   disabled + `busy` spinner states), `Card.tsx`, `Input.tsx` +
   `TextArea.tsx` (styled, incl. a `FileButton.tsx` that hides the native
   file input behind a secondary button showing the chosen filename),
   `Badge.tsx` (score tiers + state variants), `Banner.tsx` (info/warn/
   danger — restyle ProfileHealthBanner with it), `Spinner.tsx`,
   `EmptyState.tsx` (icon-free: big short heading + one secondary line).
   Each with a vitest snapshot-free render test (assert classes/roles, follow
   the repo's existing test style).
3. **App shell** (`web/app/(app)/layout.tsx`): slim top bar — wordmark left,
   Feed / Settings links (active state = text-primary + amber underline
   offset), sign-out on the right (small ghost button; wire to the existing
   supabase signOut if present, else add the one-liner route). Content in
   the spec'd container. Footer: single secondary-text line "jobify — a
   private beta for friends".
4. **Restyle feed + settings with the primitives** — NO logic changes:
   MatchCard → `Card` with title/company prominent, badge + reason line
   (LLM reasons `text-primary`, rubric reasons secondary), actions as
   ghost buttons that don't shout; section headers with counts; dismissed
   behind a quiet disclosure. Settings → cards for spend (progress bar
   against cap, amber fill) and BYO key (masked …last4, danger ghost for
   remove). Keep every existing test green — update selectors/classes in
   tests only where the restyle legitimately changed them.
5. **Root layout** (`web/app/layout.tsx`): metadata (title "jobify",
   description "a job feed that actually knows you"), bg/text base classes.

## Exit criteria

- `npm run build`, `npx vitest run`, `npx tsc --noEmit` all green.
- Zero new npm dependencies; zero changes under `web/lib/` (except none),
  `web/app/api/`, `jobify/`.
- `bash scripts/scrub_gate.sh` passes (no personal tokens introduced).
- Commit: `UX-1: design tokens + ui primitives + app shell; feed/settings restyle`.
- Push; do NOT merge — review-then-merge.
