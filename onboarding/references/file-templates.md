# Output file templates

Skeletons for the eight files you write into the target dir. Fill each from the
interview answers (see `stages.md`). Match the **heavy-inline-comment** style of
`profile.example/` so the user can hand-edit later — the comments are part of the
deliverable, not scaffolding to strip.

Authoritative shapes: `onboarding/schema/*.schema.json` (the three YAML files)
and `onboarding/schema/markdown-files.md` (the five prose files). When in doubt,
read the matching file in `profile.example/` — it is a complete, valid instance.

Hard-required (validator ERRORs if missing): **`profile.yml`** `identity.name`,
`identity.email`, and the full `application_defaults` block. Everything else is
recommended (WARNs) but you should fill it — quality drops without it.

---

## 1. `profile.yml` (REQUIRED structure)

Top-level keys, in this order:

```yaml
identity:
  name: <full name>            # required
  email: <email>               # required
  phone: <phone>               # optional but form-filled
  location_base: <City, ST>
  linkedin: <url/handle>
  website: <url>
  github: <url/handle>

background_summary: |
  2–5 sentence narrative of who they are professionally and the through-line.

location_and_compensation:
  base: <City, ST>
  remote_acceptable: <true|false>
  in_person_acceptable: <free text>
  relocation: <free text>
  current_comp_usd: <number or string>
  target_comp_usd: "<range or single, as a string>"

what_he_is_looking_for:
  tier_1:
    label: <short label>
    reference_role: <optional concrete example role>
    notes: <optional>
  tier_2: { label: <...>, notes: <...> }
  tier_3: { label: <...>, notes: <...> }

archetypes:                    # 1–N lanes; see stage 6
  <snake_case_key>:
    label: <one-line lane name>
    framing: |
      How to position the candidate for this lane.
    emphasis_proof_points:
      - <experience to lead with>
    tone_guidance: |
      Register / vocabulary notes.
    bullet_template: |
      [verb] [thing] for [audience], [outcome]. Example: "..."

how_he_works: |
  Short working-style note: what gets the best out of them.

key_technical_skills:
  - <real, defensible skill or skill cluster>

application_defaults:          # REQUIRED — every key read by the submit prefill
  work_authorization: <us_citizen | permanent_resident | visa_holder | needs_sponsorship>
  visa_sponsorship_needed: <true|false>
  earliest_start_date: <free text>
  relocation_willingness: <free text>
  in_person_willingness: <free text>
  ai_policy_ack: |
    <honest, human-in-the-loop statement>
  previous_interview_with_company: {}   # map slug->bool; {} if none

resume_template: <Template_Stem>   # stage 7 pick (filename stem, no .pdf)

personal: |
  Optional humanizing color (hobbies, location story) for cover letters.
```

Validation: must parse as a dict; `identity` needs `name`+`email`;
`application_defaults` needs all seven keys; `previous_interview_with_company`
must be a map (may be `{}`).

---

## 2. `thesis.md` (the JUDGMENT document — scorer reads it FIRST)

```markdown
# Hunting Thesis — <Name>

> Read first by the scorer. Encodes judgment, not facts. When this file and
> other profile prose disagree, this file wins.

## The thesis in one paragraph
<who they are + the ideal next role + what they're flexible/inflexible on>

## Hard constraints (violating any = score floor, do not surface)
- <remote/location constraint>
- <comp floor>
- <domain dealbreakers>
- <degree-gate constraint, if any>

## Tiers
**Tier 1 — <...>** <when to score generously>
**Tier 2 — <...>**
**Tier 3 — <...>** <filter hard>

## Energy signals (weight JD language against these)
Strong positive: <day-to-day that excites them>
Strong negative: <day-to-day that drains them>

## Named companies (calibration anchors — generalize from the *why*)
<the shape of the target, not an allowlist>

## Tone notes for downstream prompts
<how materials should frame them; what NOT to round them up/down to>
```

Validity: non-empty; starts with a `# ` title so the scorer banner reads cleanly.

---

## 3. `voice-profile.md`

Required `## ` sections (loader splits on these; at least one is mandatory):

```markdown
# Voice Profile — <Name>

<!-- Derived from real writing samples in stage 4, not a template. -->

## How He Communicates
- <concrete pattern observed in their sample>

## What NOT to Do
- <anti-patterns / banned phrasings>

## What TO Do
- <positive guidance>

## Cover Letter Guidelines
<structure + length, in their register>

## Resume Guidelines
- <bullet style; the never-fabricate rule>
```

Use their gender/pronoun framing if they state one; the section *titles* above
are what the loader keys on, so keep them.

---

## 4. `article-digest.md`

```markdown
# <Name> — Article Digest (Proof Points + Metrics)

## The narrative through-line
<one paragraph: the thread across roles>

## <Employer / era>
- **<claim>**, <evidence: system, scale, outcome>. Cite when <JD signal>.

## Metrics we are confident about
- <defensible number, safe to cite verbatim>

## Metrics we DO NOT have (do not invent)
- <the fence: anything fuzzy/aspirational; the tailor must never fabricate>
```

Validity: non-empty; must contain a "do not invent" / "do not have" guardrail
section. Numbers consistent with `cv.md`.

---

## 5. `cv.md`

The master CV / source of truth. Conventional sections: contact block, summary,
technical skills, experience (reverse-chronological with bullets), education,
optional projects. Built from stage 1, factual, complete — the tailor selects
and reorders from it but never invents beyond it.

---

## 6. `learned-insights.md` (fully optional; ships ~empty)

```markdown
# <Name> — Learned Insights

USER-LAYER. Starts empty; accumulates generalizable preferences over time.
Loaded AFTER profile.yml + cv.md, so an insight here overrides earlier prose.
Leave empty if you have nothing yet — it loads fine empty.
```

---

## 7. `disqualifiers.yml`

```yaml
hard_disqualifiers:        # match any => floored, not surfaced
  - <absolute no>
soft_concerns:             # drag score down, surfaced in scorer reasoning
  - <yellow flag>
```

Both keys required (lists of free-text strings; may not be omitted, but each
list may be short).

---

## 8. `portals.yml`

See `portals-seeding.md` for how to populate and **verify** slugs. Shape:

```yaml
greenhouse: { companies: [ { slug: <slug>, name: <Name> } ] }
lever:      { companies: [] }
ashby:      { companies: [ { slug: <slug>, name: <Name> } ] }
workday:    { companies: [] }   # rows need tenant, site, dc, name
title_filter:
  reject_substrings:    [ <each non-empty> ]   # >=1
  prefer_substrings:    [ <each non-empty> ]   # >=1
  seniority_substrings: [ <each non-empty> ]   # >=1
```

All four ATS sections required (company lists may be empty/null); `title_filter`
and its three substring lists must be present and non-empty.
