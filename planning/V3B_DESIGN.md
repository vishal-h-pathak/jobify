# V3b — The Tailor (design)

_Fable design pass, 2026-07-16. PRODUCT_VISION.md §3: "Tailor this" on any match →
side-by-side resume + cover letter, every claim chip-sourced, unsourced claims cannot
render. Builds on main (all of V3a merged)._

**Decisions up front:** GHA `workflow_dispatch` compute plane (not Vercel); one new
table (`tailor_runs`, migration **0012**); private `job-materials/{user}/{posting}/`
storage. The Python tailor is reused verbatim for generation + LaTeX; additions are a
hosted orchestrator, a claims verifier, and one additive prompt field. The LLM proposes
citations; a deterministic Python verifier decides what renders.

---

## 1. Architecture

### 1.1 Compute path: GHA workflow_dispatch — decided

| Consideration | GHA (chosen) | Vercel serverless |
|---|---|---|
| LaTeX/PDF | `pdflatex` via apt; templates need only CM/LM fonts (`jobify/resume_templates/README.md:80`) | No TeX; 250MB bundle cap kills it outright |
| Python reuse | `pip install -e .`, call `jobify.tailor.*` directly | Full rewrite of prompts/render/trim loop in TS — forbidden |
| Latency | ~2–4 min total (boot ~30s, pip ~45s, TeX apt ~60–90s cacheable, 5 LLM calls ~60–90s, render+trim ~20s) — within the 1–3 min brief, design the wait honestly (§3.2) | ~90s, but moot given the two rows above |
| Precedent | Mirrors `web/lib/hunt/dispatchHunt.ts:74-85` + `hosted-hunt.yml` exactly | New pattern |

New workflow `.github/workflows/hosted-tailor.yml`, inputs `user_id, posting_id, run_id,
mode (tailor|render), template`. Same secrets posture as `hosted-hunt.yml:67-103`
(SUPABASE_*, ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, JOBIFY_KEY_ENCRYPTION_SECRET;
no VOYAGE/SERP). Adds an apt TeX step (`texlive-latex-base -latex-recommended
-fonts-recommended lmodern`, cached via `awalsh128/cache-apt-pkgs-action`) and console
script `jobify-hosted-tailor --run <run_id>`.

`mode=render` is the zero-LLM path: re-render PDFs from the stored post-trim
`tailored.json` + verified claims with a different template — powers the template
switcher and post-edit re-renders at ~$0 and ~90s.

### 1.2 What is reused vs written (cite-level)

**Reused unchanged:**
- Prompts + anti-fabrication house rules: `jobify/tailor/prompts/_shared.md` (honesty
  :7-14, anti-slop :25-45, ASCII/ATS :61-67, voice :78-89), `tailor_latex_resume.md`
  (select/reorder-never-fabricate :3-7, one-page caps :75-84), `tailor_cover_letter.md`.
- Prompt-cached system prefix: `prompts/__init__.py::cached_system_blocks` (:190-215)
  already injects the merged profile (thesis-first) + **voice-profile.md** — the voice
  sample drives tone with zero new plumbing.
- Generation fns: `tailor/resume.py::tailor_resume`, `tailor/latex_resume.py::
  generate_tailored_latex` (+ `_fit_to_one_page` trim loop :579,
  `_select_template` :129), `tailor/cover_letter.py::generate_cover_letter`,
  `tailor/cover_letter_pdf.py::render_cover_letter_pdf`,
  `tailor/archetype.py::classify_archetype`, `tailor/normalize.py::normalize_for_ats`.
- Per-user profile hydration: `jobify/profile_loader.py::materialize_profile_dir`
  (:212) — one GHA run = one user, so the worker sets `JOBIFY_PROFILE_DIR` to the
  materialized dir **before** importing tailor modules and the package's process-global
  caches (`_PROFILE_CACHE`, `_SYSTEM_BLOCKS_CACHE`) are per-user for free. This is the
  single-user→hosted seam; do not use the fanout's dir-parameterized loaders here.
- Templates: all 5 in `jobify/resume_templates/` + the CI parse gate
  (`tests/test_resume_templates.py`).

**Changed (one additive field):** `tailor_latex_resume.md`'s JSON contract gains
`"sources"` on each bullet/skill category/summary (§2.2). Single-user path ignores it.

**NOT reused:** `jobify/tailor/pipeline.py` orchestration — welded to the single-user
`jobs` table (`process_one_approved_job` :123-327: mark_preparing, resume_path-as-JSON,
form_answers, url_resolver). Hosted gets a thin orchestrator `jobify/hosted/tailoring.py`
over the pure functions above; `form_answers` is V3c's concern, skipped entirely.

### 1.3 Status tracking: `tailor_runs` table — decided (vs storage-derivation)

Storage-existence can't represent "generating" (the whole wait UX), errors, cooldowns, or
cost — and GHA dispatch returns 204 with no run handle. One table, migration
**`0012_v3b_tailor.sql`** (next free after `0011_v3a_modules.sql`):

```sql
CREATE TABLE tailor_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  posting_id text NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed')),
  mode text NOT NULL DEFAULT 'tailor' CHECK (mode IN ('tailor','render')),
  template text, feedback text,                 -- regenerate-with-note (§3.4)
  progress jsonb NOT NULL DEFAULT '[]',         -- [{step,label,at}] worker-appended
  doc_sha256 text,                              -- profiles.doc snapshot hash at gen time
  dropped_count int, error text, cost_usd numeric,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX tailor_runs_one_active
  ON tailor_runs (user_id, posting_id) WHERE status IN ('queued','running');
-- RLS: own-row SELECT (polling). INSERT/UPDATE service-role only — the web route
-- gates then inserts with the admin client; the worker updates via service role.
-- + storage.objects SELECT policy for bucket 'job-materials':
--   (storage.foldername(name))[1] = auth.uid()::text
```

Web inserts the row first, then dispatches with `run_id` — the worker updates that exact
row (tighter than hunts, where outcome is inferred). Stale-queue reaping: the poll route
maps `queued` older than 10 min to `failed` ("runner never picked this up — try again");
no cron needed at friends scale.

### 1.4 Storage — `job-materials/{user_id}/{posting_id}/`

Same bucket name as `jobify/shared/storage.py::BUCKET` (:33), **user-scoped** path prefix
(the hosted live project has no bucket yet — ops §4.4). Private; reads via the
path-prefix RLS policy above, so the authed web client downloads directly (no signed-URL
plumbing). Worker writes with service role:

```
resume.pdf  cover_letter.pdf  cover_letter.txt  tailored.json  claims.json  render_meta.json
```

`tailored.json` is the **post-trim** structured resume (what the PDF actually shows —
stored after `_fit_to_one_page`, so the HTML viewer and PDF can never diverge).
Regenerating overwrites in place; `tailor_runs` history keeps the audit trail.

### 1.5 Budget rails

Token profile per tailor (Sonnet-class, `TAILOR_CLAUDE_MODEL`, `jobify/config.py:169`):
archetype 3k/0.3k + resume 12k/2k + latex 10k/4k + CL 10k/1.5k + claims attribution
(§2.2) 8k/2k in/out; cached system prefix at ~10% input price ⇒ **≈$0.20–0.35/tailor,
budget $0.50 ceiling.**

- **Ledger row per LLM call** (constitutional): `jobify.db.insert_budget_ledger_row`
  (:257) with events `tailor_archetype` / `tailor_resume` / `tailor_latex` /
  `tailor_cover` / `tailor_claims`, `run_id = tailor_runs.id`, `byo` honored.
- **Gates at dispatch (web):** month-to-date pool spend < cap
  (`web/lib/db/ledger.ts::getMonthToDateSpend/getBudgetCap`) unless BYO; plus
  **5 tailors/user/day** (count today's mode='tailor' rows) so one user can't drain the
  $5 cap in an afternoon. `mode=render` runs are exempt (zero LLM).
- **Gate in worker:** re-check cap before the first LLM call (dispatch→run gap), same
  posture as fanout's rechecks (docs/COST_RAILS.md §1). BYO reuses
  `jobify/hosted/keycrypt.py` + `api_keys`, passing `api_key=` through
  `jobify.shared.llm.complete_with_usage` exactly as fanout does.
- **Cooldown:** the unique active-run index IS the per-posting cooldown; the daily
  counter is the per-user one. No new timestamp columns.

---

## 2. The traceable-claims model (the heart)

### 2.1 Claim units and `claims.json`

Everything rendered decomposes into **claim units**: resume — each bullet, skills-
category value, org/title/period header, summary line, education entry; cover letter —
each sentence. `claims.json`:

```jsonc
{ "version": 1, "doc_sha256": "…",           // pins the profiles.doc snapshot verified against
  "units": [{
    "id": "r.exp0.b2",                        // stable: surface.section.index
    "surface": "resume", "kind": "bullet",    // bullet|skill|header|edu|summary|cl_sentence
    "text": "Cut detector inference p95 from 2.1s to 380ms on Jetson Orin",
    "sources": [{ "file": "cv.md", "start_line": 41, "end_line": 43,
                  "quote": "optimized RT-DETRv2 inference… 2.1s to 380ms" }],
    "numbers": [{ "token": "2.1s", "basis": "confirmed_metric" },
                { "token": "380ms", "basis": "confirmed_metric" }],
    "status": "verified"                      // verified|user_edited|voice
  }],
  "dropped": [{ "id": "…", "text": "…", "reason": "number_not_confirmed|missing_span|new_entity" }] }
```

`quote` is the anchor, line numbers are hints: the profile doc keeps evolving, so chips
resolve by quote-match against the current doc and fall back to showing the pinned quote
with "your profile has changed since this was generated" when it no longer matches.

### 2.2 How generation produces it

- **Resume (structured already):** the JSON contract in `tailor_latex_resume.md` gains a
  per-bullet/per-category `"sources": [{file, quote}]` field — the model cites the cv.md
  passage as it writes each item (attribution-at-write beats post-hoc); additive, the
  single-user path ignores it. Headers/education/identity verify structurally (rule 3).
- **Cover letter (free prose, prompt untouched):** the CL voice rules are the crown
  jewel — don't pollute them with JSON. A **separate attribution call** (`tailor_claims`,
  new prompt `attribute_claims.md`) takes the finished letter + profile doc and returns
  sentence units with proposed sources, tagging connective no-fact sentences `"voice"`.
- Either way the LLM output is a **proposal**. The authority is the verifier.

### 2.3 The verification rules (server-side, deterministic, `jobify/tailor/claims.py`)

Strict substring is too rigid for prose; "model says it's fine" is not verification.
The defensible middle — three mechanical rules, unit-testable without an LLM:

1. **Numbers — exact match, no exceptions (the do-not-invent fence).** Extract every
   numeric token from every unit (regex: `%`, `$`, multipliers, counts, latencies,
   ranges). Each must appear **verbatim** in either (a) a `## Confirmed metrics` line of
   `article-digest.md` (the metric-honesty pass output the dossier already parses —
   `web/lib/dossier/derive.ts:277-279`), or (b) the unit's own cited cv.md span text.
   Any token in the `## Never use` list fails regardless of (b). A failed number drops
   the **whole unit** — a sentence built on an unconfirmed number is unsound, not
   trimmable. Dates/tenures from structured `experience[].period` / `education[].period`
   are whitelisted (they're checked by rule 3 instead).
2. **Prose — cited span must exist, verbatim.** Every `sources[]` entry must resolve:
   file present in the pinned doc snapshot, and `quote` found in it
   (whitespace/ASCII-normalized via `normalize_for_ats` on both sides). Then the
   **new-entity check**: every proper noun / technical term in the claim (capitalized
   multi-char tokens, known-tool lexicon from cv.md's Skills section) must appear
   somewhere in the union of its cited quotes. Paraphrase of verbs and framing is free;
   new tools, employers, titles, and outcomes are not. This targets the actual
   fabrication failure mode without blocking honest rewording.
3. **Structural facts — exact.** `experience[].{org,title,location,period}`,
   `education[].{school,degree,period}`, and the identity header
   (`latex_resume.py::base_identity` :42) must string-match the cv.md parse /
   `profile.yml::identity`. No citation needed; no drift allowed.

`kind:"voice"` CL sentences are exempt from rule 2 **only if** they pass a hard
emptiness check: zero numbers, zero unknown entities. A "voice" sentence that mentions
a technology is reclassified factual and verified (or dropped).

### 2.4 The render rule

**The renderer consumes only `status ∈ {verified, user_edited, voice}` units.** Dropped
units never reach the LaTeX source or CL text; they land in `claims.json.dropped` +
`tailor_runs.dropped_count` and surface in the UI (§3.3) — never silently. An experience
entry left with zero bullets drops too. No code path exists from an unverified claim to
a PDF — the never-fabricate guarantee as an interface property (PRODUCT_VISION.md §3).

### 2.5 User edits

Inline edits are **user-authored**: stored per unit id as `tailored.json` overlays,
`status:"user_edited"`, exempt from sourcing (their own assertion — the *product* never
fabricates), rendered with a distinct "yours" chip so provenance stays honest on screen.
Edits trigger a `mode=render` re-run. Regeneration re-verifies everything; user edits
survive only if the unit id persists (otherwise offered in a recovery list).

---

## 3. UX

### 3.1 Entry
`MatchCard` (all groups except dismissed) gains **"Tailor this"** → `/materials/
[postingId]`, which POSTs `/api/tailor/run` if no succeeded run exists. Budget/cooldown
refusals reuse the hunt button's outcome grammar (`feed/huntOutcome.ts`): concrete
time/count copy, never a dead button.

### 3.2 The wait (~2–4 min, designed honestly)
No fake percent bar. A stage checklist driven by `tailor_runs.progress` (worker appends
at each real step), polled every 4s: *reading your profile → choosing the frame →
drafting the resume → writing the cover letter → checking every claim against your
profile → rendering PDFs*; stages get timestamps, and the claim-check stage shows its
result inline ("41 claims checked, 2 withheld"). Posting description + match reason
fill the right column so the wait reads as preparation, not a spinner. Failure: plain
error + "try again" (re-dispatch allowed once the row is failed).

### 3.3 Side-by-side viewer
Resume left (HTML render of post-trim `tailored.json` — same source as the PDF, WYSIWYG
by construction), cover letter right. Hover/tap any unit → **source chip**: quoted
profile line, file label, deep-link to the dossier section. Numbers get amber metric
chips naming the confirmed metric. Header strip: template picker (5 thumbnails;
switching = `mode=render` re-run, ~90s, $0), **Download resume/CL PDFs / Copy letter
text**, and — when `dropped_count > 0` — an honesty drawer: "2 claims withheld — no
source in your profile," each with its reason and an "add this to your profile" link to
the relevant module. The drawer is the trust feature; never hide it.

### 3.4 Edit affordances
Per-unit: inline edit (→ user-authored, §2.5). Per-surface: "Regenerate resume/letter"
with an optional one-line steer note (`tailor_runs.feedback`, appended to the task
prompt — facts still gated by the same verifier, so steering can't smuggle fabrication).
Full re-tailors count against the daily counter; renders don't.

### 3.5 Materials afterward
Succeeded run ⇒ the match card shows a "Materials" badge; `/materials` (nav item) lists
every tailored match with template, date, dropped-count, downloads. One materials set per
posting (latest wins); `tailor_runs` rows remain as history.

---

## 4. Decomposition — 3 Sonnet sessions, disjoint ownership

### S1 — Python worker + claims verifier + workflow (no web files)
Owns: `jobify/hosted/tailoring.py`, `jobify/tailor/claims.py`, `attribute_claims.md`,
the additive `sources` field in `tailor_latex_resume.md`, console script
`jobify-hosted-tailor`, `hosted-tailor.yml`, migration **`0012_v3b_tailor.sql`** (§1.3),
migrations README entry. Worker sequence: claim row → materialize profile (set
`JOBIFY_PROFILE_DIR`) → gate budget/BYO → archetype → resume → CL → attribution →
**verify (pure)** → drop → render (trim loop) → upload 6 objects → progress/ledger rows
throughout → mark succeeded/failed; `mode=render` short-circuits to storage re-render.
Tests: table-driven verifier cases (the bulk of the session), worker happy + drop paths
with a fake LLM. Proof: one real GHA run producing a PDF with a deliberately fabricated
metric dropped and logged.

### S2 — web plumbing (no UI polish, no Python)
Owns: `web/lib/tailor/dispatchTailor.ts` (mirror `dispatchHunt.ts`, incl. the
never-log-token rule :72-73), `POST /api/tailor/run` (gates §1.5, insert row, dispatch),
`GET /api/tailor/runs?posting_id=` (poll + stale mapping §1.3), `web/lib/db/tailorRuns.ts`,
`web/lib/materials/` storage-read helpers + claims/tailored types, regenerated supabase
types. Tests mirror `dispatchHunt.test.ts` (fake fetch/now).

### S3 — the tailor surface (web UI only, consumes S2's lib)
Owns: `/materials/[postingId]` page (wait state §3.2, viewer §3.3, edits §3.4),
`/materials` index, `MatchCard` "Tailor this"/"Materials" affordances, dossier anchor
ids on `/profile` for chip deep-links. Warm-dark editorial per PRODUCT_VISION.md §4 —
amber for metric chips and the mirror-grade moment when the materials first resolve.

Order: S1 → S2 → S3 (S2/S3 can overlap once S2's types land). Each: review-then-merge,
scrub gate (`scripts/scrub_gate.sh` — no operator strings in prompts/fixtures; use the
Alex Quinn example persona in all tests), migration number pinned at 0012.

### 4.4 Ops (owner, one sitting)
1. Live Supabase: create **private** bucket `job-materials`; apply 0012 (table + RLS +
   storage policies).
2. GitHub/Vercel: no new secrets or env vars — hosted-tailor.yml reuses hosted-hunt's
   set, and the existing dispatch token covers the new workflow (same repo).
3. Smoke: tailor one real match on the owner account; check 5 ledger rows, claims.json,
   and that the withheld-claims drawer renders.

---

## 5. Open questions for the owner (build-changing only)

1. **Resume header identity:** hosted profiles carry `identity.name/email`, but
   `latex_resume.py::base_identity` also wants location/linkedin/website, which no V3a
   module collects. Ship a minimal header (name + email + logistics base), or add a
   contact-details field-set to the evidence module first? (Blocks S1's render fixture.)
2. **Voice-sentence exemption (§2.3):** confirm that connective CL sentences with zero
   factual content may render unsourced (chip reads "your voice"), rather than forcing
   every sentence to cite — the alternative makes letters cite-per-sentence stilted and
   will visibly degrade the writing. (Changes verifier + chip design.)
3. **Budget shape:** tailoring shares the $5/month pool cap with hunting, plus the
   5/day counter — acceptable, or should tailor spend get its own monthly sub-cap so a
   heavy tailoring week can't starve the user's hunts? (Changes gate logic + settings
   copy.)
