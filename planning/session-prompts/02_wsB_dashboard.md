# Session 02 — WS-B: Carve out & trim the dashboard  (Wave 1)

**Run from:** `jobify/` (after Session 00). Reads `../portfolio/` (read-only).
**Depends on:** Session 00.
**Parallel-safe with:** WS-A1 (01), WS-C (03) — touches only `jobify/dashboard/`.

---

## Context

The dashboard cockpit lives inside the personal site `portfolio` (Next.js 16,
React 19, Tailwind 4, Supabase JS, Anthropic SDK). We want ONLY the cockpit, as a
standalone app under `jobify/dashboard/`, with the personal marketing site left
behind and several pages trimmed. Read `jobify/planning/PROJECT_PLAN.md` §1, §5
(WS-B). The pipeline writes Supabase rows; the dashboard reads them and exposes
the human-in-the-loop actions.

## Goal

A standalone `jobify/dashboard/` Next.js app that builds and type-checks on its
own, contains only the kept routes, and has no "Vishal Pathak" identity baked in.

## Tasks

1. **Create `jobify/dashboard/`** as a clean Next.js app. Copy from
   `../portfolio/`:
   - `app/dashboard/{page,layout}.tsx`, `BrowseView.tsx`, `review/[job_id]/`,
     `review/page.tsx`, `login/page.tsx`, `RunsPanel.tsx`, `ManualTailorPanel.tsx`,
     `components/**`, `lib/**` (dashboard lib).
   - `app/api/dashboard/**` EXCEPT the trimmed routes (see step 3),
     `app/api/materials/**`, `app/api/chat/**`, `app/api/dashboard-login/**`.
   - `middleware.ts`, `app/lib/supabase*.ts`, `app/lib/job-status*`,
     `app/lib/github-dispatch.ts`, `app/globals.css`, config files
     (`next.config`, `tsconfig`, `tailwind`, `package.json`).

2. **DROP the personal site entirely:** `app/page.tsx` landing, `components/`
   like `Hero`, `Experience`, `Project`, `Notebook`, `WorkshopRail`, `Bench`,
   `Contact`, `Footer`, `Nav`, `app/projects/**`, `app/meridian/**`,
   `app/api/meridian/**`, `app/api/bench/**`, `app/agents/[token]/**`,
   `app/opengraph-image.tsx`, `app/icon.svg` personalization, `cellular-gaits`,
   `VOICE_PROFILE.md`, papercuts content.

3. **DROP the trimmed dashboard features:**
   - pages: `app/dashboard/insights/`, `app/dashboard/stories/`.
   - components: `MatchAgent.tsx`.
   - API routes: `app/api/dashboard/profile-insight/`,
     `app/api/dashboard/pattern-analyses/`, `app/api/dashboard/stories/**`.
   - Remove nav links / imports referencing the above so the build is clean.

4. **KEEP and keep working:** the triage/browse list, the **review cockpit**
   (materials accordions, copy-answer buttons, pre-fill screenshot, sticky action
   bar), the **RunsPanel**, and the three one-click actions: **Hunt**, **Tailor**,
   **Pre-fill Form** (plus Mark Applied / Skip / Mark Failed / Open Manually). The
   action buttons dispatch GitHub workflows / flip Supabase status as today — keep
   that wiring (`github-dispatch.ts`).

5. **Parameterize identity.** Replace "Vishal Pathak", `vishal.pa.thak.io`, and
   any personal branding with values from env / a small `site.config.ts`
   (e.g. `NEXT_PUBLIC_SITE_NAME`). Provide a minimal neutral login → dashboard
   shell; no public homepage needed (redirect `/` → `/dashboard`).

6. **`.env.local.example`** listing: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ANTHROPIC_API_KEY`, `DASHBOARD_PASSWORD`, `GITHUB_OWNER/REPO/PAT` (for the
   dispatch buttons), `NEXT_PUBLIC_SITE_NAME`.

## Exit criteria

- `cd jobify/dashboard && npm install && npx tsc --noEmit` passes.
- `npm run build` succeeds.
- Only the kept routes exist; grep finds no `vishal|pathak|thak.io|meridian|papercuts`.
- Commit: `WS-B: standalone trimmed dashboard cockpit`.

## Note
Don't worry about the `job-status.generated.ts` type source — it's generated from
the pipeline's `status.json`; just copy the current generated file. WS-C keeps
the status contract intact.
