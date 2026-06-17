# Session 00 — Phase 0: Scaffold & Extract  (SERIAL — run first, alone)

**Run from:** the parent dir that contains `job-pipeline/`, `portfolio/`, and the
empty `jobify/` (e.g. `~/dev/jarvis/`). Source repos are read-only references;
all writes go into `jobify/`.

**Prereqs:** none. This must complete and be committed before any other session.

---

## Context

We are extracting the canonical job-hunting pipeline (`job-pipeline`, Python
package `jobify`) and, in a later session, its dashboard (buried in
`portfolio`), into a fresh standalone repo `jobify/` — a single-user, local tool
a technical friend can clone and run. Full plan: `jobify/planning/PROJECT_PLAN.md`.
Read it first.

This session is **mechanical only**: copy, rename, strip. Do NOT generalize
persona data yet (Vishal's profile stays as-is this session — WS-A handles it).

## Goal

A fresh `jobify/` repo that imports and collects tests under the new package
name, with dead weight and trimmed subsystems removed.

## Tasks

1. **Fresh git repo.** `cd jobify && git init`. Do NOT copy `job-pipeline/.git`.

2. **Copy the pipeline source** from `../job-pipeline/` into `jobify/`, EXCLUDING:
   `.git`, `.git.backup-*`, `.venv`, `venv`, `__pycache__`, `.ruff_cache`,
   `.pytest_cache`, `.playwright-mcp`, `graphify-out/`, `output/`, any `.env`,
   `.DS_Store`. (Use rsync with excludes or `git archive` from the source.)

3. **Rename the package `jobify` → `jobify`** (~777 refs):
   - Move `jobify/` → `jobify/jobify/` (the package dir).
   - Update every `import jobify` / `from jobify...` across code + tests.
   - `pyproject.toml`: package name, `[project.scripts]` →
     `jobify-hunt = "jobify.hunt.agent:run"`, `jobify-tailor`, `jobify-submit`,
     and any `jobify-tailor-one`.
   - Rename env var `JOBIFY_PROFILE_DIR` → `JOBIFY_PROFILE_DIR` in code + docs.
   - Grep `jobify` to zero (outside this planning folder).

4. **Strip personal / PR-narrative docs:** `CHANGELOG.md` (the migration story),
   all root `PROMPT_*.md`, `CLAUDE_CODE_PROMPT_MANUAL_TAILOR.md`,
   `RUNBOOK_setup_and_testing.md` (WS-C writes a fresh `docs/SETUP.md`). Keep
   code; we'll write a new `README.md` in Phase F.

5. **Remove the trimmed subsystems** (dashboard pages for these are dropped too):
   - tailor `interview_prep/` (STAR-story generator) and its tests.
   - the closed-loop pattern-analysis script (`analyze_patterns.py`) and tests.
   - any cron/Makefile targets that invoke the two above.
   - Leave `star_stories` / `pattern_analyses` SQL alone for now — WS-C owns
     schema cleanup. Just make sure nothing imports the deleted modules.

6. **Keep** `.claude/`, `.github/` (WS-C will genericize workflows), `Makefile`,
   `migrations`/`scripts` with SQL, `tests/`, `pyproject.toml`.

## Exit criteria (verify before committing)

- `python3.11 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"` succeeds.
- `python -c "import jobify"` works.
- `pytest --collect-only` collects with no import errors (deleted-module imports
  all removed).
- `grep -rEi "jobify" jobify/ pyproject.toml tests/` returns nothing.
- Commit: `git add -A && git commit -m "Phase 0: scaffold jobify from job-pipeline (rename + strip)"`.

## Notes for the agent
- Persona data (Vishal) is EXPECTED to still be present after this session.
- If a test fails for non-import reasons, leave it; WS-A/D will fix as persona
  data is generalized. The bar here is *collection*, not *passing*.
