# UX-1 — The Gate and the Document (design)

_Fable design pass, 2026-07-19, from the owner's live first-walkthrough findings.
Two owner directives, verbatim intent:_
- **D-UX1 (the gate):** "the profile must be built before the rest of the site is
  even accessible." Pre-completion, the app IS the intake — there is nothing else
  to navigate to. The founding architecture ("profile is the product") becomes an
  interface property.
- **D5 (the document):** the dossier is a *deliverable users can leave with* — a
  saved document that stays useful for their job search in ANY AI tool, whether or
  not they ever run a jobify hunt. Export it beautifully; make it paste-ready.

Field evidence driving this: the owner completed the anchor, navigated away, and
could not find his way back — resumability existed server-side (V3A §1.2) but no
funnel ever pulled a returning user into it; the nav offered Feed/Profile/Settings
to a user with no profile.

---

## 1. Completion, defined once

One source of truth, one helper: **`intakeComplete(user)` ⇔
`onboarding_sessions.status = 'complete'`** (set at mirror-accept, already). No
other signal (profiles-row existence is NOT completion — the incremental doc
exists mid-intake for the checkpoint hunt). Expose it from one server helper in
`web/lib/onboarding/` and use it EVERYWHERE below — never re-derive inline.

## 2. The gate (pre-completion state machine)

- **Route guard, server-side, in the `(app)` layout** (not middleware — the
  layout already loads the user; one extra session read, cached per request):
  any `(app)` route except `/onboarding` → redirect to `/onboarding` when
  incomplete. `/submit/*`, `/tailor/*`, `/profile`, `/feed`, `/settings`: all
  gated. API routes keep their own guards (packet's 409 etc. — unchanged).
- **Nav, pre-completion:** brand + a single item — **"Your intake"** with live
  progress ("7 of 12") — plus Sign out. Feed/Profile/Settings do not render at
  all. (Admins additionally keep Admin — the cockpit exception.) Post-completion:
  today's full nav.
- **Landing page (`/`), signed-in + incomplete:** straight to `/onboarding` — no
  marketing page for someone mid-intake.
- **Resume moment:** `/onboarding` already lands on the next incomplete module
  (V3A resumability). Add the one missing affordance: a compact "Welcome back —
  picking up at <module label>" line over the rail on return visits (session
  `updated_at` > 30 min ago), so re-entry is oriented, not abrupt.
- **Completion moment:** mirror-accept already routes to `/profile`; the nav
  swap from one-item to full is the visible "the site unlocked" beat. Keep it.
- **Sign-in flow:** unchanged; the gate handles everything post-auth.

## 3. The document (D5 — dossier export, on `/profile`)

A "Your dossier, yours to keep" affordance row on the dossier page:

1. **Download (.md)** — `GET /api/profile/export?format=md`: the dossier
   rendered as clean markdown from the same `derive.ts` output the page uses
   (never a second derivation): identity header, the three layers
   (facts/wants/texture), confirmed metrics, voice notes, change-log tail, and a
   provenance footer ("generated from your jobify profile, <date>; every line
   traces to your own words"). Filename `dossier-<first_name>-<date>.md`.
2. **Copy for AI tools** — a one-click copy block: the same content prefixed
   with a short instruction header ("This is my verified professional profile —
   my background, values, working style, and confirmed metrics, in my own words.
   Use it as ground truth when helping me with job-search tasks."). This is the
   paste-into-any-assistant artifact — the owner's "keep using it elsewhere"
   intent, made literal.
3. **Print/PDF** — print stylesheet on the dossier page (the kit's
   `body:has()` scoping pattern), so Cmd+P yields a clean typographic one-pager.
   No server-side PDF (no TeX on Vercel; print CSS is the P0-proven path).

Constitution note: the export contains ONLY dossier-derived content — never
`application_profiles` data (work-auth/self-ID stay encrypted and out of every
export by construction).

## 4. Empty-state + orientation audit (post-gate, small but part of the pass)

With the gate in place most bad empty states become unreachable; the survivors
get one honest line + one action each: Feed with zero matches ("your first hunt
is running / run one now"), `/tailor` index with no materials ("tailor your
first match from the feed"), Settings before any resume upload. Every page
answers "what is this and what do I do next" in its first viewport line.

## 5. Decomposition — 2 Sonnet sessions, disjoint

### UX1-A (prompt 43): the gate
Owns: the completion helper, `(app)` layout guard + nav states + progress
fetch, landing-page redirect, welcome-back line, empty-state copy passes on
feed/tailor-index/settings, tests (guard matrix: incomplete×route → redirect;
complete×route → renders; admin exception; nav render states). No new routes,
no migrations.

### UX1-B (prompt 44): the document + paper cuts
Owns: `/api/profile/export` (md renderer from derive output + tests incl. the
never-export-application_profiles assertion), the dossier-page affordance row
(download / copy-for-AI / print CSS), and two parked paper cuts: the
`"identity"` stage-literal cleanup in `types.ts`/`InterviewStage` (audit
finding — dead literal the DB would reject; delete it and the legacy import
chain it rode in on), and the kit "I applied" in-flight guard. Tests throughout.

Shared contract: the completion helper's name/signature + the export route path,
pinned in both prompts. Order: parallel, off main, worktrees, review-then-merge,
scrub gate — the standing ritual.

## 6. Explicitly out of scope (so this wave stays shippable today)
Voice-guide microcopy rewrite beyond the audited pages; dossier redesign;
onboarding module reordering; any submitter/E2 work; admin ADM-3 dashboards.
