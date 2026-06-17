# SETUP — get jobify running on your laptop

A from-scratch setup for a technical friend. It's a **single-user, local
tool**: you bring your own API keys and your own Supabase project, and it
runs on your machine. Budget ~30–45 minutes, most of it waiting on
installs and Supabase provisioning.

> **Bring your own keys.** jobify ships no secrets. The only hard
> requirements are a **Supabase** project and an **Anthropic API key**.
> Everything else (paid job sources, email digests, the legacy hosted
> submitter) is optional — see `.env.example`, where each var is tagged
> `[required]` or `[optional]`.

---

## 0. Prerequisites

- **Python ≥ 3.11**
- **Node.js ≥ 20** (only for the dashboard, step 8)
- **git**
- A **Supabase** account (free tier is fine) — https://supabase.com
- An **Anthropic API key** — https://console.anthropic.com
- **A TeX distribution with `pdflatex`** — the tailor compiles the resume to a
  one-page PDF. macOS: BasicTeX or MacTeX (`brew install --cask basictex`);
  Debian/Ubuntu: `sudo apt-get install texlive-latex-recommended
  texlive-fonts-recommended`. The resume gallery uses only standard fonts
  (Computer Modern + Latin Modern Sans), so the recommended set is enough.
  Without `pdflatex` the tailor still runs but skips PDF generation.
- **`pdftotext`** (from **poppler**) — optional, used by the resume
  template parse-gate test (`pytest -k resume_templates`). macOS:
  `brew install poppler`; Debian/Ubuntu: `sudo apt-get install poppler-utils`.
  `pdfminer.six` (installed via `pip install -e ".[dev]"`) is a pure-Python
  fallback the gate also accepts, so poppler is not strictly required.

---

## 1. Clone

```bash
git clone <your-fork-url> jobify
cd jobify
```

---

## 2. Create a Supabase project

1. https://supabase.com → **New project**. Pick a name and a strong
   database password; note the region.
2. Wait for it to finish provisioning (~2 min).
3. Grab two values from **Project Settings → API**:
   - **Project URL** → your `SUPABASE_URL`
   - **service_role** secret (under "Project API keys") → your
     `SUPABASE_SERVICE_ROLE_KEY`

> jobify runs **service-role only**. The tables use row-level security
> with no policies, so an anon key would silently read empty result sets
> (HTTP 200, no error). The service-role key bypasses RLS;
> `jobify.db` refuses a key it can tell is anon and fails loud. Keep the
> service-role key out of any client-side code.

---

## 3. Apply the schema

Apply the single baseline migration to your fresh project. Pick one:

- **SQL Editor (easiest):** Supabase dashboard → **SQL Editor** → **New
  query** → paste the contents of
  [`jobify/migrations/0001_init.sql`](../jobify/migrations/0001_init.sql)
  → **Run**.
- **Supabase CLI:** `supabase db execute --file jobify/migrations/0001_init.sql`
  (after `supabase link`).

It creates `jobs`, `runs`, `application_attempts`, and the private
`job-materials` Storage bucket. It's idempotent — re-running is safe. See
[`jobify/migrations/README.md`](../jobify/migrations/README.md) for what
each object is.

---

## 4. Python environment

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"
```

Verify:

```bash
pytest            # the suite should pass
```

---

## 5. Install the browser (for the submit pre-fill)

The submit step drives a local Chromium via Playwright:

```bash
playwright install chromium
```

---

## 6. Fill in `.env`

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

| Variable | Where it comes from |
|---|---|
| `SUPABASE_URL` | step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | step 2 |
| `SUPABASE_KEY` | set to the **same** service-role key (legacy fallback name) |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com |

Everything else is optional — read the inline comments in `.env.example`.

---

## 7. Generate your profile (onboarding)

jobify is no longer hard-coded to anyone — your personal "ground-truth"
layer lives in a **profile directory** (`JOBIFY_PROFILE_DIR`, defaults to
`./profile`). Generate it by running the **onboarding flow once**: it
interviews you, ingests your resume, and writes the persona files the
pipeline reads.

Follow [`docs/ONBOARDING.md`](ONBOARDING.md) (authored separately). When
it finishes you'll have a populated `profile/` and know which template
your tailored resume uses.

---

## 8. Run the hunt

```bash
jobify-hunt --once
```

This discovers and scores roles against your profile and upserts them
into Supabase. Add `--mode us_wide` to widen beyond Atlanta + remote.
Re-score existing rows against an updated profile with
`jobify-hunt --rescore` (a dry run that prints an eligible-row count and an
LLM cost estimate); add `--execute` to actually spend the tokens and write
results.

Then tailor an approved row and pre-fill its application:

```bash
jobify-tailor     # generate resume + cover letter + form-answer drafts
jobify-submit     # open the live application with every field pre-filled (stops before submit)
```

---

## 9. The dashboard (optional but recommended)

The Next.js cockpit gives you the three one-click actions (Hunt / Tailor /
Pre-fill Form), the review cockpit, and a runs panel.

```bash
cd dashboard
npm install
cp .env.local.example .env.local   # fill in SUPABASE_* + DASHBOARD_PASSWORD
npm run dev
```

Open http://localhost:3000, log in with `DASHBOARD_PASSWORD`, and drive
the pipeline from there. The env vars the dashboard needs are documented
inline in [`dashboard/.env.local.example`](../dashboard/.env.local.example).
For a production-style run use `npm run build && npm start` instead of
`npm run dev`.

---

## Optional: the hunt cron (GitHub Actions)

`.github/workflows/hunt.yml` can run the hunt on a daily schedule on your
own fork. It's **opt-in and disabled by default**:

1. Add these repository secrets (**Settings → Secrets and variables →
   Actions**): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_KEY`, `ANTHROPIC_API_KEY`. Optional:
   `CLAUDE_CODE_OAUTH_TOKEN`, `RESEND_API_KEY`, `SERPAPI_KEY`,
   `JSEARCH_API_KEY`.
2. Un-comment the `schedule:` block in `hunt.yml`.

`ci.yml` (pytest + the scrub gate) needs no secrets.

---

## Troubleshooting

- **`jobify.db` raises about an anon key at startup** — you set an anon
  key where the service-role key is expected. Re-check step 2 / step 6.
- **Hunt returns nothing** — your `profile/portals.yml` has no targets,
  or the free sources had nothing new. Add targets during onboarding;
  optionally add `SERPAPI_KEY` / `JSEARCH_API_KEY` to widen reach.
- **Pre-fill can't find the browser** — re-run `playwright install
  chromium` inside the activated venv.
