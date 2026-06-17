# The frozen profile contract (WS-A1)

This directory is the **authoritative description of the user-layer profile
contract**: the eight files that make up one user's profile, what each
contains, and which fields are required. WS-A1 (Session 01) froze this. The
onboarding flow (WS-E) generates files that satisfy it; the hunt/tailor/submit
code (WS-A2, WS-D, WS-F) consumes it through `jobify.profile_loader`.

**Hand-off note for Sessions 04 (WS-A2), 05 (WS-D/onboarding consumers),
06 (WS-E), 07 (WS-F):** rely on the filenames + required keys below without
re-deriving them. If you need to change the contract, change it *here first*,
then update `jobify/profile_loader.py` and `profile.example/` to match.

## The one rule

Every profile file is read through **`jobify.profile_loader`** from a single
directory resolved in this order:

1. `JOBIFY_PROFILE_DIR` env var, if set (a generated profile or a test fixture)
2. `<repo_root>/profile/` if it exists (the active user's profile)
3. `<repo_root>/profile.example/` (the shipped neutral example)

**No code reads a persona file by a hard-coded path outside the loader.** Add
a new file to the contract by adding a loader function, not by reaching into
the directory from a caller.

## The eight files

| File | Loader(s) | Required? | Shape doc |
|---|---|---|---|
| `profile.yml` | `load_profile` (dict), `load_profile_text` (raw), `load_archetypes`, `load_application_defaults` | **Yes** | [profile.schema.json](profile.schema.json) |
| `thesis.md` | `load_thesis` (raw) | Recommended | [markdown-files.md](markdown-files.md) |
| `voice-profile.md` | `load_voice_profile` (dict: `raw` + `sections`) | Recommended | [markdown-files.md](markdown-files.md) |
| `article-digest.md` | `load_article_digest` (raw) | Recommended | [markdown-files.md](markdown-files.md) |
| `cv.md` | `load_cv` (raw) | Recommended | [markdown-files.md](markdown-files.md) |
| `learned-insights.md` | `load_learned_insights` (raw) | Optional (ships ~empty) | [markdown-files.md](markdown-files.md) |
| `disqualifiers.yml` | `load_disqualifiers` (dict), `load_disqualifiers_text` (raw) | Recommended | [disqualifiers.schema.json](disqualifiers.schema.json) |
| `portals.yml` | `load_portals` (dict) | Recommended (hunt needs it) | [portals.schema.json](portals.schema.json) |

"Required" = the loader-dependent code paths assume it exists. Everything
else degrades gracefully (missing dict → `{}`, missing text → `""`), but
scoring/tailoring quality drops without it.

## Required keys at a glance

**`profile.yml`** (the only file with hard-required structure):

- `identity` — must include `name` and `email`. Optional but form-filled:
  `phone`, `location_base`, `linkedin`, `website`, `github`.
- `application_defaults` — the PII the submit pre-fill types into forms.
  **Every key below is read by `jobify/submit/adapters/_common.py
  ::applicant_fields`** — do not rename:
  - `work_authorization` (e.g. `us_citizen`)
  - `visa_sponsorship_needed` (bool)
  - `earliest_start_date` (free text)
  - `relocation_willingness` (free text)
  - `in_person_willingness` (free text)
  - `ai_policy_ack` (free text)
  - `previous_interview_with_company` (map of company-slug → bool; may be `{}`)
- Strongly recommended: `background_summary`, `location_and_compensation`,
  `what_he_is_looking_for` (tiers), `archetypes`, `key_technical_skills`,
  `how_he_works`, `personal`.

**`disqualifiers.yml`**: `hard_disqualifiers` (list) + `soft_concerns` (list).

**`portals.yml`**: `greenhouse` / `lever` / `ashby` / `workday` (each
`{companies: [...]}`) + `title_filter` (`reject_substrings`,
`prefer_substrings`, `seniority_substrings` — each a non-empty list).

The submit adapters also read identity-derived fields the tailor forwards
into each `jobs` row (`first_name`, `last_name`, `full_name`, `email`,
`phone`, `linkedin`, `website`/`portfolio_url`, `github`,
`current_location`, `current_company`, `current_title`) — these originate
from `identity` + `application_defaults` here. See `applicant_fields` for the
full key-aliasing.

## The canonical example

`profile.example/` is a complete, loadable instance of this contract for a
fictional persona (Alex Quinn, backend/platform engineer). Use it as the
reference when generating or validating a real profile:

```
JOBIFY_PROFILE_DIR=profile.example python -c \
  "from jobify.profile_loader import load_profile; print(load_profile()['identity'])"
```
