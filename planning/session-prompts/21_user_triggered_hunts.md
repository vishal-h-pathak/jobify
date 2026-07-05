# Session 21 — HNT-1: User-triggered hunts + admin routing fix  (Hosted wave 7, single session — DEMO-CRITICAL TODAY)

**Model: Sonnet.** All decisions are made below. Bias to the minimal faithful
implementation — this ships to a live tester today.
**Run from:** a `jobify-wt/hosted-hnt1-triggers` worktree.
**You own the whole repo this wave** (no parallel session). Still off-limits:
`jobify/tailor/`, `jobify/submit/`, `jobify/shared/status.py`, `dashboard/`,
migrations 0001–0006.

---

## Product change (decided)

Scoring stops being automatic. The daily cron keeps DISCOVERY only (free,
keeps the postings pool fresh). Each user scores on demand via a **"Run my
hunt"** button on their feed. Guardrails: per-user cooldown + all existing
budget rails unchanged.

## Tasks

1. **Worker flags** (`jobify/hosted/worker.py` + entry point):
   - `jobify-hosted-hunt --discovery-only` → discovery, zero fan-out.
   - `jobify-hosted-hunt --user <uuid>` → discovery (it's free/idempotent),
     then fan-out for ONLY that user.
   - No flags → current behavior (unchanged, for compat).
   Summary log + ntfy line gains the mode.
2. **Workflow** (`.github/workflows/hosted-hunt.yml`):
   - `workflow_dispatch` gains optional input `user_id` (string). Job maps:
     input present → `--user <id>`; dispatch without input → full run
     (admin/manual compat); **schedule → `--discovery-only`**.
3. **Migration `0007_hunt_cooldown.sql`** (additive, idempotent):
   `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_hunt_requested_at TIMESTAMPTZ;`
   (Header comment: written service-role-only by the trigger route; no new
   RLS policy — users already can't update columns they don't send, and the
   own-row UPDATE policy covering profiles is acceptable here since a user
   gaming their own cooldown timestamp only DELAYS their own hunts... NO —
   users CAN update their own profiles rows via the 0002 policy, so a
   malicious user could null the column to bypass cooldown. Acceptable for
   invite-only beta; note it in the migration header as a known limitation
   with the fix (column-level privileges or a separate table) parked.)
4. **Trigger route** `POST /api/hunt/run` (new, `web/app/api/hunt/`):
   auth → invite-or-admin gate (same pattern as onboarding routes) → profile
   exists + `validation_status` not invalid → cooldown check
   (`last_hunt_requested_at` + `HUNT_COOLDOWN_HOURS` env, default 6; admins
   bypass cooldown) → dispatch GitHub workflow via REST
   (`POST https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/hosted-hunt.yml/dispatches`,
   body `{ref:"main", inputs:{user_id}}`, auth `Bearer ${GITHUB_DISPATCH_TOKEN}`,
   both env vars server-only; 204 = success) → service-role-update
   `last_hunt_requested_at` → return `{ok, cooldown_until}`. Map failures
   honestly: 429 with `cooldown_until` when rate-limited, 502 when GitHub
   dispatch fails, 503 when env unset (with a log). Never expose the token.
5. **Feed button** (`web/app/(app)/feed/` + a small client component):
   primary "Run my hunt" button in the feed header; on success swaps to a
   disabled "Hunt running — results usually land in ~3 minutes" state and
   the page auto-refreshes (router.refresh()) every 20s for 5 minutes, then
   stops with a "refresh to check" note. On 429 show the cooldown time
   ("next hunt available at H:MM"). Empty-state copy updates: "the hunter
   runs when you ask" replaces the daily-cron wording (check ALL copy that
   mentions daily hunts — feed empty states + onboarding wrap line).
6. **Admin routing fix** (polish item): the auth callback's no-`next`
   default and the `/invite` page's signed-in checks send ADMINS to
   `/admin` (instead of `/invite`); non-admin logic unchanged. Also add a
   "Run hunt for user" button per row in the admin Users card (dispatches
   with that user_id; admin bypass on cooldown).
7. **docs/OPERATIONS.md**: new env vars (`GITHUB_DISPATCH_TOKEN` — fine-
   grained PAT, Actions read/write on the repo, Vercel Production +
   `.env.hosted`; `GITHUB_REPO` e.g. `owner/repo` — env var, NOT hardcoded:
   scrub gate forbids the real slug in code; `HUNT_COOLDOWN_HOURS`),
   cron-is-discovery-only note, cooldown-bypass known limitation.

## Tests

Worker: flag routing (discovery-only never calls fan-out; --user scores
exactly one user). Route: 401/403 gates, cooldown 429 with correct
`cooldown_until`, admin bypass, dispatch payload shape (fake fetch), token
never in response/body/logs, 503 on missing env. Feed button states
(idle/running/cooldown). Callback admin default. All fakes, no network.

## Exit criteria

- Full Python suite + web vitest + tsc + `npm run build` green; scrub gate
  PASS (no repo slug/token literals).
- `git diff` stays out of the off-limits paths.
- Commit: `HNT-1: user-triggered hunts (dispatch route + feed button + discovery-only cron) + admin routing`.
- Push; do NOT merge — review-then-merge. Flag anything you had to interpret.
