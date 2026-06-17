# Example interview transcript (abbreviated)

A condensed walkthrough of the seven onboarding stages (`../references/stages.md`)
as run for the fictional **Sam Rivera**, producing the `profile/` dir next to
this file. Real runs are longer and more back-and-forth; this shows the *shape*
of the conversation and how each stage maps to output. `A:` = assistant (the
skill), `U:` = user.

---

**A:** This takes ~20–30 minutes. Best results if you have your resume and a real
writing sample (an old cover letter or a substantial message) on hand — stage 4
needs real text. Where should I write the profile? Default is `./profile/`.

**U:** `./profile/` is fine. Resume attached.

## Stage 1 — Resume ingestion

**A:** *(reads the PDF)* Here's what I extracted — correct anything wrong:
- Lumen Labs, Senior Frontend Engineer (Design Systems), Feb 2021–present:
  component library (9 teams, ~30% less net-new UI code), token pipeline, a11y
  in CI (40+ violations fixed), contributors 2→15.
- Marigold Commerce, Frontend Engineer, 2018–2021: checkout WCAG 2.1 AA, LCP
  4.5s→1.8s, first shared component package.
- Brightpath Studio, Web Developer, 2016–2018: agency sites, first CSS
  conventions.
- B.A. Design + CS minor, UT Austin, 2016. Projects: token-bridge (~450★),
  a11y-snippets.

**U:** All correct. The 9 teams and 40+ violations are hard numbers; the ~30% is
an estimate I'd stand behind.

## Stage 2 — Identity & logistics

**A:** Name, email, phone, links, location? Remote/relocation? Current + target
comp?

**U:** Sam Rivera, sam.rivera@example.com, +1-555-0179, Austin TX. LinkedIn /
GitHub / site under `samrivera-example`. Remote or Austin-hybrid; **not**
relocating. Currently $145k, targeting $150–180k.

**A:** Now the form-fill defaults the auto-submit needs — work authorization?
Visa sponsorship? Earliest start? Relocation wording? In-person preference? An
AI-use statement? Interviewed anywhere you're targeting before?

**U:** US citizen, no sponsorship. Two weeks' notice. Remote/Austin-local only,
not relocating. Hybrid ok, occasional onsite fine. Use a standard honest
AI-policy line. No prior interviews yet.

→ `identity`, `location_and_compensation`, `application_defaults` in `profile.yml`.

## Stage 3 — Targeting

**A:** Ideal role? What's good-but-not-the-dream? The floor?

**U:** Dream: design systems / frontend platform — owning the component library.
Tier 2: accessibility-focused frontend where a11y is actually funded. Tier 3:
senior product frontend, but only if the mission and design culture are real.

**A:** Hard no's? Yellow flags? Anything your background rules out?

**U:** No ad-tech / surveillance. No roles where frontend is a side duty to a
backend. No pay cut, no relocation. Yellow flags: a11y as a checkbox, no design
partner, super early-stage with nothing built yet. No degree gate — my B.A. is
fine for what I'm targeting.

→ `what_he_is_looking_for`, `thesis.md`, `disqualifiers.yml`.

## Stage 4 — Voice elicitation

**A:** Paste a real writing sample — an old cover letter or a design RFC.

**U:** *(pastes a cover letter + a component-API RFC)*

**A:** Reading those, your voice is: clear medium-length sentences, user-grounded
("so a keyboard user can…"), concrete about craft (names the token, the WCAG
criterion), collaborative, quietly opinionated. You avoid "pixel-perfect /
seamless / rockstar" and inflated verbs. That's what I'll encode — sound right?

**U:** Yes, that's me.

→ `voice-profile.md` (the five `## ` sections).

## Stage 5 — Proof points

**A:** Sorting your bullets into claim→evidence and splitting confident metrics
from a do-not-invent fence. Confident: 9 teams, ~30% less UI code, 40+
violations, WCAG 2.1 AA checkout, LCP 4.5→1.8s, contributors 2→15, ~450 stars.
Do-not-invent: revenue/conversion, user/traffic counts, team-size-managed,
audit scores. Agree these are off-limits?

**U:** Agree — I have no revenue or conversion numbers.

→ `article-digest.md`.

## Stage 6 — Archetypes

**A:** From your tiers I'd derive two lanes: **design_systems** (owns the library
+ tokens + adoption) and **accessibility** (a11y as correctness, shipped fixes).
Both tie to real proof points. Want a third for the Tier-3 generalist case?

**U:** Two is right — I don't want to dilute it.

→ `archetypes:` in `profile.yml`.

## Stage 7 — Resume template pick

**A:** Gallery options: `Comp_Neuroscience_Resume` (dense, research-leaning) and
`Research_ML_Resume` (clean, projects-forward). For a design-systems IC with
strong projects, I'd suggest `Research_ML_Resume`.

**U:** Go with `Research_ML_Resume`.

→ `resume_template: Research_ML_Resume` in `profile.yml`.

## Generate → validate

**A:** Wrote all eight files to `./profile/` and seeded `portals.yml` from your
targets (Figma, Vercel on Greenhouse; Shopify on Lever; Linear on Ashby — verify
the slugs with the curl checks before relying on them). Running the validator…

```
$ python onboarding/validate_profile.py ./profile
PROFILE VALID (required checks passed)
```

Green. Put your keys in `.env` (see `docs/SETUP.md`) — the profile holds no
secrets. Next step: `jobify-hunt --once` to see your first scored roles. You can
hand-edit any file later; code never overwrites your profile.
