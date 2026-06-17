# Validating the generated profile

After writing all eight files, run the validator and resolve every **ERROR**
before telling the user onboarding is done. WARNINGs are quality gaps — surface
them, but they don't block.

## Run it

```
python onboarding/validate_profile.py <target-dir>      # default ./profile
python onboarding/validate_profile.py <target-dir> --json   # machine-readable
```

- Exit `0` = all required checks pass (WARNINGs allowed).
- Exit `1` = at least one ERROR; the profile will not behave correctly downstream.

The script validates by pointing `JOBIFY_PROFILE_DIR` at the target dir and
exercising every `jobify.profile_loader` function — so "passes here" means
"hunt/tailor/submit read it identically." If `jsonschema` is installed it runs
the full Draft 2020-12 schema check; otherwise it falls back to required-key
checks (install with `pip install jsonschema`, or run inside the project venv,
for the strict pass).

## Fixing each failure

| Message | Cause | Fix |
|---|---|---|
| `profile.yml: missing or not a mapping` | file absent / not valid YAML | rewrite `profile.yml` (stage 2/3/6) |
| `profile.yml: 'identity' missing required key(s): email` | no name/email | re-ask stage 2 identity |
| `application_defaults missing required key(s): …` | skipped a PII default | re-ask stage 2; all seven are required |
| `previous_interview_with_company must be a map` | wrote a list/string | use `{}` or `slug: bool` pairs |
| `voice-profile.md: no '## ' sections` | missing headings | add the `## ` sections (stage 4) |
| `portals.yml: schema violation … title_filter` | a substring list empty | each of the three lists needs ≥1 entry |
| `disqualifiers.yml: schema violation` | missing `hard_disqualifiers`/`soft_concerns` | add both keys (lists; may be short) |

## After it's green

Confirm a real loader read, the same call the pipeline makes:

```
JOBIFY_PROFILE_DIR=<target-dir> python -c \
  "from jobify.profile_loader import load_profile, load_application_defaults; \
   p=load_profile(); print('identity:', p['identity']['name']); \
   print('defaults keys:', sorted(load_application_defaults()))"
```

Then the smoke path the WS-E exit criteria call for (needs keys in `.env`):

```
JOBIFY_PROFILE_DIR=<target-dir> jobify-hunt --once      # discovers + scores roles
```

A tailored render + a submit pre-fill complete the smoke, but those need the
full environment (Anthropic key, Supabase, an approved job row). `jobify-hunt
--once` running clean on the seeded `portals.yml` is the fast first signal.
