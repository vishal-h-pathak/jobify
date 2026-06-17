# onboarding/examples — the golden persona

`profile/` here is **one complete, valid profile produced by the onboarding
flow** (`../SKILL.md`) — a fictional frontend / design-systems engineer named
**Sam Rivera**. It exists for two reasons:

1. **Worked reference.** It shows what a finished, contract-valid profile looks
   like end-to-end — useful when running the interview and wondering "what does
   a good `thesis.md` / `article-digest.md` / archetype actually read like?"
2. **Shared test fixture.** It is the golden persona referenced by
   `tests/test_onboarding_example.py`, which asserts the directory loads through
   `jobify.profile_loader` and passes every `onboarding/schema/` check. WS-A2 /
   WS-D / WS-F can point `JOBIFY_PROFILE_DIR` at it for a second, distinct
   persona (the shipped `profile.example/` is a backend engineer; this is a
   frontend one — together they prove the contract holds across very different
   candidates).

Everything in it is **obviously fictional** (`@example.com`, `*-example`
handles, invented employers and metrics). Keep it that way.

## Contents

```
profile/
  profile.yml          identity, logistics, tiers, 2 archetypes, application_defaults, resume_template
  thesis.md            judgment doc — hard constraints, tiers, energy signals
  voice-profile.md     5 voice sections derived from a (fictional) writing sample
  article-digest.md    claim→evidence proof points + confident vs do-not-invent metrics
  cv.md                master CV (numbers consistent with article-digest.md)
  disqualifiers.yml    hard_disqualifiers + soft_concerns
  portals.yml          seeded Greenhouse/Lever/Ashby boards + title_filter
  learned-insights.md  near-empty (the one fully-optional file)
interview-transcript.md  an abbreviated run of the seven stages that produced profile/
```

## Validate it yourself

```
python onboarding/validate_profile.py onboarding/examples/profile
# → PROFILE VALID (required checks passed)

JOBIFY_PROFILE_DIR=onboarding/examples/profile python -c \
  "from jobify.profile_loader import load_profile; print(load_profile()['identity']['name'])"
# → Sam Rivera
```
