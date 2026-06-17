# jobify — Project Plan

> Goal: take the working single-user job-hunting pipeline (currently spread
> across `job-pipeline` + the dashboard buried inside `portfolio`) and turn it
> into a **clean, self-contained tool a technical friend can clone, set up on
> his own laptop, and use** — with the same three-click hunt → tailor → submit
> flow you have today. The centerpiece is a **conversational onboarding flow**
> that interviews the new user, ingests his resume, and generates the entire
> personal "ground-truth" layer the pipeline runs on, so nothing is hard-coded
> to Vishal anymore.

This document is the master plan. Once approved, each **workstream** becomes one
or more Claude Code session prompts (parallelizable where marked).

---

## 1. Scope & locked-in decisions

**In scope:** a single-user, locally-runnable tool. One person per install,
bring-your-own API keys, runs on a laptop. Same functionality you have now.

**Explicitly out of scope (deferred):** hosting, multi-tenancy, user accounts,
per-user workers, billing. We keep the design from painting us into a corner
(see §6) but build none of it now.

| Decision | Choice |
|---|---|
| Package / scripts | rename `jobify` → `jobify`; `jobify-hunt` / `jobify-tailor` / `jobify-submit` |
| Git | fresh repo, no history |
| Contents | pipeline **and** a trimmed dashboard cockpit (the personal marketing site in `portfolio` is left behind) |
| Users | **single-user, local.** Existing `DASHBOARD_PASSWORD` gate is fine. |
| Profiles | **filesystem** profile dir resolved by the existing loader seam (no database) |
| Submission | **keep the auto-prefill.** Hunt → Tailor → Submit are one click each; Submit opens the application with every field filled, user reviews and presses the site's own Submit (stop-at-submit). |
| Keys | **bring-your-own** via `.env` — Anthropic (+ optional SerpAPI/JSearch) |
| Resume output | **small gallery** of one-page templates, every one verified ATS-parsable |
| Dashboard pages | **trim.** Keep the **runs panel** + the **review cockpit** + the job triage/browse list + the three one-click actions. **Drop** insights/pattern-analysis, STAR-stories bank, and the Match-Agent profile-insight writeback. |

---

## 2. The target user experience

Friend clones the repo, follows `SETUP.md` (Supabase project + his keys), runs
the **onboarding skill once** to generate his profile from his resume + a short
interview, then per job gets three one-click actions in the dashboard:

1. **Hunt** (one click) — discover + score roles against *his* profile.
2. **Tailor** (one click) — generate his tailored resume + cover letter +
   form-answer drafts.
3. **Submit** (one click) — open the live application with every field
   pre-filled from his profile/PII, **stopping before submit**.

He switches to the opened application, confirms it looks right, and clicks the
application's own Submit button. jobify never sends the final click.

---

## 3. The core insight: one seam carries the personalization

All user-layer reads already funnel through `jobify/profile_loader.py`, which
resolves the profile directory from an env var (`JOBIFY_PROFILE_DIR`, → renamed
`JOBIFY_PROFILE_DIR`). That is the generalization seam. Generalizing the tool is:
(a) make sure nothing bypasses the loader, (b) replace the shipped profile with
templates + a neutral example, (c) have onboarding produce a valid profile dir.
No database — the loader stays filesystem-based.

The persona layer (the onboarding output contract — eight files):

| File | Purpose | Read by |
|---|---|---|
| `profile.yml` | identity, location/comp, tiers, **archetypes**, `application_defaults` (the PII the prefill types into forms) | scorer, tailor, **submit prefill** |
| `thesis.md` | judgment: tiers, hard constraints, degree-gate rule, energy signals, anchors | scorer (placed FIRST) |
| `voice-profile.md` | how the user writes; do/don't lists; cover-letter + resume guidelines | tailor |
| `article-digest.md` | claim → evidence proof-points; confident metrics vs "do not invent" | tailor, cover letter |
| `cv.md` | master CV / source of truth for resume content | tailor, hunt |
| `disqualifiers.yml` | hard disqualifiers + soft concerns | scorer |
| `portals.yml` | the user's ATS boards to poll + title pre-filter | hunt sources |
| `learned-insights.md` | ships empty (its dashboard writer is trimmed) | tailor |

> Today these are split between top-level `profile/` and `jobify/hunt/profile/`.
> Step one of WS-A consolidates them into one profile contract the onboarding
> writes and the loader reads.

---

## 4. Target repo layout

```
jobify/
├── jobify/                      # Python package (renamed from jobify)
│   ├── hunt/  tailor/  submit/  shared/
│   ├── config.py  db.py  notify.py  profile_loader.py
│   └── ...
├── dashboard/                   # trimmed Next.js cockpit (carved from portfolio)
│   ├── app/dashboard/ (triage + review + runs) + app/api/{dashboard,materials,chat}/
│   └── ...
├── onboarding/                  # the conversational onboarding flow
│   ├── SKILL.md  prompts/  schema/  examples/
├── resume_templates/            # ATS-safe one-page gallery + parse tests
├── profile.example/             # template profile (placeholders + comments)
├── migrations/                  # Supabase schema (jobs, runs, application_attempts)
├── .github/workflows/           # CI + optional single-user hunt cron
├── docs/  SETUP.md  ARCHITECTURE.md  ONBOARDING.md
├── .env.example
├── pyproject.toml
└── README.md
```

---

## 5. Workstreams

### Phase 0 — Scaffold & extract  *(serial; everything depends on it)*
- Fresh `git init`. Copy `job-pipeline` source, excluding `.git`,
  `.venv`/`venv`, `__pycache__`, `.ruff_cache`, `.pytest_cache`, `graphify-out/`,
  `output/`, `.playwright-mcp/`, any `.env`.
- Rename `jobify` → `jobify` everywhere (777 refs): package dir, imports,
  `pyproject.toml` scripts, `JOBIFY_*` → `JOBIFY_*` env vars, tests.
- Strip PR-narrative / personal working docs (`CHANGELOG` migration story,
  `PROMPT_*.md`, `CLAUDE_CODE_PROMPT_MANUAL_TAILOR.md`).
- Remove the now-trimmed subsystems: tailor `interview_prep/` (STAR generator),
  the closed-loop pattern-analysis script, and the cron that feeds them.
- **Exit:** `pip install -e .`, `import jobify`, `pytest --collect-only` pass
  under the new name (persona data still Vishal here — Phase 0 is mechanical).

### WS-A — Generalize the persona layer  *(parallel after Phase 0)*
- Consolidate all eight persona files into one profile contract; update loader +
  callers; rename the env var to `JOBIFY_PROFILE_DIR`.
- Audit all 234 persona hits; route every one through `profile_loader` /
  `application_defaults`. Known offenders: `tailor/latex_resume.py`
  (`BASE_RESUME`), hunt+tailor prompt files (`_shared.md`, `scorer.md`,
  `tailor_*.md`, `classify_archetype.md`, `form_answers.md`),
  `submit/adapters/_common.py` (`applicant_fields` / `FAKE_APPLICANT` — **the
  values the prefill types into forms**), `notify.py` (`cockpit_url`),
  `check_liveness.py`, smoke tests, `tests/fixtures/beacon_job.json`.
- Replace `profile/` with `profile.example/`: every file, a neutral example
  persona, heavy inline comments. Generalize the `archetypes` block to 2–3
  generic lanes + "how to add your own"; drop the archetype that cites *this
  pipeline* as the user's own proof artifact.
- **Exit:** `grep -ri "vishal\|pathak\|gtri\|thak.io"` over `jobify/` is empty;
  `pytest` green on the example persona; `jobify-hunt --once` runs on the example
  `portals.yml`.

### WS-B — Carve out & trim the dashboard  *(parallel after Phase 0)*
- Copy only the cockpit from `portfolio`: `app/dashboard/{page,layout,
  BrowseView,review}` + the **RunsPanel** + `app/api/{dashboard,materials,chat,
  dashboard-login}/**`, `middleware.ts`, `app/lib/supabase*.ts`,
  `app/lib/job-status*`, the dashboard components, `globals.css`.
- **Drop** the personal site (Hero/Experience/projects/Meridian/Bench/papercuts/
  `agents/[token]`/landing) **and** the trimmed pages: `dashboard/insights`,
  `dashboard/stories`, `MatchAgent.tsx` + `/api/dashboard/profile-insight` +
  `/api/dashboard/pattern-analyses` + `/api/dashboard/stories`.
- Minimal neutral shell (login → dashboard). Parameterize site identity.
- Keep the three one-click actions wired (Hunt / Tailor / **Pre-fill Form**), the
  review cockpit (materials, copy answers, Mark Applied / Skip / Mark Failed),
  and the runs panel. Keep the `DASHBOARD_PASSWORD` gate.
- **Exit:** dashboard builds + `tsc --noEmit` standalone; only the kept routes
  remain; identity parameterized.

### WS-C — Schema, infra & setup docs  *(parallel after Phase 0)*
- Consolidate the migrations into a clean ordered baseline for the **kept**
  tables only: `jobs`, `runs`, `application_attempts` (+ the storage bucket).
  Drop `star_stories` and `pattern_analyses`. Preserve the canonical
  `status.py` / `status.json` / CHECK-constraint contract.
- Scrub infra identifiers (Supabase project id `sbmsxerwgylpfkkkjtku`, GitHub
  `vishal-h-pathak/job-pipeline`, Vercel, `vishal.pa.thak.io`).
- `.env.example` for pipeline + dashboard (BYO Anthropic key, optional SerpAPI/
  JSearch, Supabase, Browserbase only if used). Generic `.github/workflows/`
  (CI + optional single-user hunt cron).
- `docs/SETUP.md` written for a technical friend doing a fast laptop setup
  (Supabase project + apply migrations; Python ≥3.11 venv + `pip install -e .`;
  `.env` with his keys; `playwright install chromium`; run onboarding; `npm i`
  + dashboard `.env.local`). Plus `docs/ARCHITECTURE.md`.
- **Exit:** migrations apply to a fresh Supabase project; SETUP.md followed
  end-to-end yields a working empty pipeline + dashboard.

### WS-D — Generalize the auto-prefill submit  *(parallel after Phase 0; depends on WS-A's `applicant_fields`)*
- Keep the local visible-browser prefill (the `jobify-submit` local-Playwright
  path) as core. Make every value it types come from the user's profile /
  `application_defaults` via the loader — nothing hard-coded.
- Verify the per-ATS DOM fillers (Greenhouse, Lever, Ashby) + generic fallback
  fill generalized PII; confirm stop-at-submit (never clicks final submit).
- **Exit:** with the example persona, `jobify-submit` opens a real ATS form with
  identity/contact/location/comp/answers filled, parked before submit.

### WS-E — Build the onboarding flow  *(starts once WS-A freezes the profile contract)*
- `onboarding/SKILL.md` interview stages: (1) ingest resume PDF/DOCX/MD/txt;
  (2) identity & logistics incl. the PII the prefill needs + `application_defaults`;
  (3) targeting — tiers, dream companies/industries, disqualifiers, degree-gate;
  (4) **voice elicitation from real writing samples**, not a template;
  (5) proof points → claim/evidence + confident-metrics list;
  (6) archetypes from his tiers; (7) **resume template pick** from the gallery.
- Generate all eight profile files; validate against `onboarding/schema/` and the
  loader contract. Seed a starter `portals.yml` from stated targets (+ surface
  the ATS-slug verification procedure). Note where to put his keys (`.env`).
- `onboarding/examples/` holds one golden persona reused as the shared test
  fixture across WS-A/B/C/D/F.
- **Exit:** running the flow on a sample resume yields a profile that loads,
  drives a green `jobify-hunt --once`, a tailored render, and a successful
  prefill.

### WS-F — ATS-safe resume template gallery  *(parallel; pairs with WS-A + WS-E)*
- Build a small gallery (≈3–5) of distinct one-page LaTeX templates.
- **Every template must pass an ATS-parsability gate:** render to PDF, extract
  text (`pdftotext` / a parser), assert structure + all content come back as
  clean selectable text in the right order. No multi-column layouts that
  scramble extraction, no text-in-images, standard fonts, nothing critical in
  headers/footers. Automated test.
- Wire the tailor to honor the user's selected template; onboarding offers the
  pick.
- **Exit:** all gallery templates pass the parse gate in CI; tailor renders each.

### Phase F — Integration & verification  *(serial; last)*
- Fresh-clone dry run: SETUP.md → onboarding generates the example persona →
  `pytest` → `jobify-hunt --once` → tailor one row → `jobify-submit` prefill →
  dashboard `tsc --noEmit` + boot.
- **CI grep gate:** fail if `vishal|pathak|gtri|thak\.io|papercuts|
  sbmsxerwgylpfkkkjtku` reappears outside `onboarding/examples/`.
- Final `README.md` + a 5-minute quickstart aimed at the friend. Optional
  `general-purpose` subagent verification pass over the whole repo.

---

## 6. Parallelization map

```
Phase 0 (serial)
   │
   ├──► WS-A  generalize persona layer ───────┐
   ├──► WS-B  dashboard carve-out + trim ──────┤
   ├──► WS-C  schema / infra / setup docs ─────┤
   ├──► WS-D  generalize auto-prefill submit ──┤   (needs WS-A's applicant_fields)
   ├──► WS-F  ATS-safe resume gallery ─────────┤   (pairs with WS-A/WS-E)
   │      (WS-A freezes profile contract) ►WS-E┤
   │                                           ▼
   │                                    Phase F (serial)
```

- WS-A/B/C/D/F touch disjoint trees (python pkg vs `dashboard/` vs
  `migrations/`+`docs/` vs submit vs `resume_templates/`) → run in parallel.
- WS-D depends on WS-A's generalized `applicant_fields`; WS-E depends on WS-A's
  frozen profile contract — so do WS-A's "consolidate + freeze profile contract"
  piece first, then fan out.
- Suggested sessions: Phase 0 = 1; WS-A = 2 (contract+templates, then audit);
  WS-B = 1; WS-C = 1; WS-D = 1; WS-E = 1–2; WS-F = 1; Phase F = 1. ≈9 sessions.

---

## 7. Don't-paint-us-into-a-corner notes (for a possible future hosted version)

We are **not** building hosting now, but cheap choices that keep the door open:
- Keep all DB access in `jobify.db` (already centralized) so a `user_id` column
  + RLS could be added later without touching call sites.
- Keep the profile read path behind `profile_loader` (already true) so a future
  DB-backed backend can slot in.
- Keep keys read through `jobify.config` so per-user key storage is a later swap.

That's it — no extra work now, just don't bypass these seams.

---

## 8. Risks & open questions

- **R1 — LaTeX résumé gallery vs ATS parsability is a real constraint.** Visually
  rich layouts often break ATS text extraction. The parse gate (WS-F) keeps the
  gallery honest and limits how fancy templates can get.
- **R2 — Voice quality depends on input samples.** Onboarding must insist on
  real writing samples and degrade gracefully if the user offers little.
- **R3 — Portals need the user's targets.** Free discovery needs named
  companies/industries; paid sources optional under BYO. Onboarding seeds a
  starter list; ATS-slug verification is partly manual.
- **R4 — Submit DOM fillers are ATS-version-sensitive.** Greenhouse/Lever/Ashby
  layouts drift; the generic fallback covers the rest but is less reliable. Worth
  a smoke test per adapter in Phase F.

> No open blockers. If you're happy with this scope, say go and I'll break it
> into the Claude Code session prompts following the map in §6.
