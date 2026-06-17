# Session 08 — Phase F: Integration & verification  (SERIAL — run last, alone)

**Run from:** `jobify/`.
**Depends on:** ALL prior sessions merged (00, 01, 02, 03, 04, 05, 06, 07).

---

## Context

Final pass: prove a stranger can go from clone → running, and that no personal
data leaked through. Read `jobify/planning/PROJECT_PLAN.md` §5 (Phase F).

## Goal

A clean repo that passes a fresh-clone dry run, a CI grep gate, and ships a
README + quickstart.

## Tasks

1. **Fresh-clone dry run** (do this in a clean checkout / tmp clone, not your
   working tree):
   - Follow `docs/SETUP.md` exactly; note every place it's wrong or underspecified
     and fix the doc.
   - Run the onboarding skill to generate the example persona into `profile/`.
   - `pytest` (whole suite, with `JOBIFY_PROFILE_DIR` pointing at the generated/
     example profile) — green.
   - `jobify-hunt --once` (free sources) — produces scored rows.
   - Tailor one row → resume PDF + cover letter render.
   - `jobify-submit` prefill on a public ATS posting → form filled, parked before
     submit.
   - `cd dashboard && npm install && npx tsc --noEmit && npm run build` — clean;
     boot it and confirm the triage list, review cockpit, runs panel, and the
     three one-click actions render.
2. **CI grep gate.** Add to `ci.yml` a step that FAILS if any of these reappear
   anywhere outside `onboarding/examples/` and `profile.example/`:
   `vishal|pathak|gtri|thak\.io|papercuts|cape canaveral|sbmsxerwgylpfkkkjtku|vishal-h-pathak`.
   Run it; fix any hits.
3. **Per-adapter submit smoke** (R4): a quick check that each of Greenhouse,
   Lever, Ashby fillers still find their fields on a current sample posting; note
   any drift in `docs/` as known-issues.
4. **`README.md`** — what jobify is, the three-click flow, a 5-minute quickstart
   for the friend that points at SETUP.md + ONBOARDING.md. No personal data.
5. **Optional:** dispatch a `general-purpose` subagent to do an independent
   "fresh eyes" sweep for leftover personal data, dead imports, and broken doc
   links; fix what it finds.

## Exit criteria

- Fresh-clone dry run completes every step above.
- CI grep gate passes (green) and is wired into `ci.yml`.
- `pytest` green; dashboard builds.
- README + SETUP + ONBOARDING + ARCHITECTURE all present and accurate.
- Commit + tag: `v0.1.0 — jobify single-user release`.

## Done = ready to hand to your friend.
