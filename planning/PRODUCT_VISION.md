# jobify — Product Vision v3

_Drafted 2026-07-06 in Cowork (Fable) from the owner's full-reign brief; owner
decisions incorporated. Supersedes nothing operationally — v2 ships Saturday
unchanged; this is the map for what jobify becomes after._

## North star

Three verbs — **hunter, tailor, submitter** — hanging off one noun: a rich,
living model of a person's professional self. The profile is the product.
Everything else (the feed, the resumes, the pre-filled applications) is a
view generated from it. A user should *want* to show their jobify profile to
someone. WIP tools show you their machinery; this product shows you yourself.

## 1. The profile — one noun, three layers

- **Facts** — anchor (title/company/tenure or situation), evidence (resume,
  links), skills, logistics, comp floor. Verifiable, traceable.
- **Wants** — values (from trade-offs), direction/tiers, trajectory,
  dealbreakers, environment preferences.
- **Texture** — energy signals, range beyond title, voice, the confident-vs-
  do-not-invent metric split (the tailor's anti-fabrication fence, promoted
  to a first-class user-visible artifact).

Rendered as **the dossier**: a designed, editable profile page that reads
like a sharp recruiter's write-up of you. The dossier is the design showcase
of the whole app and the trust anchor: every hunter reason and every tailor
sentence must be traceable to a line on it.

**The psych reframe (owner-approved):** no personality instruments, no
typing, no "psychological profile" framing. The intent — how this person
works, what energizes and drains them — is captured through behavioral,
face-valid questions (energy audit, scenario trade-offs, trajectory). The
"insight" layer lives in *narrative*: reasons like "you said ambiguity
drains you — this role is heavily structured." The model may infer; the
product never labels.

## 2. Onboarding — one continuous intake, background first hunt

Owner decision: full detail up front, not a minimal core. Design answer:
**everything is one flow, but the first hunt fires silently at the midpoint
checkpoint** — by the time the user finishes, their feed exists and has
already been re-ranked by their later answers. Full detail, zero terminal
wait, and the closing screen can honestly say "12 matches, re-scored twice
while you talked."

### The intake, in order (signal-per-minute descending within phases)

**Phase I — ground truth (~8 min), then the hunt fires in the background:**
1. **Anchor** (exists): title + company + tenure, or free-text situation.
2. **Reaction calibration** (new, highest-value addition): 6–8 REAL postings
   from the live pool near their anchor; swipe interested / not + optional
   one-word why. Direct supervised signal for the ranker; doubles as the
   product demo inside onboarding.
3. **Values trade-offs** (new): 6–7 forced pairs (same pay: mission vs
   prestige; predictable 40 vs variable 50 + equity; deep specialist vs
   generalist…). Forced choice, never Likert. Maps directly to rubric
   weights.
4. **Dealbreakers** (exists): blunt, hard filters.
   → **checkpoint: hunt #1 dispatches in the background.**

**Phase II — depth (~10 min), feed re-ranks as modules complete:**
5. **Range calibration** (exists, v2): the four "Show your range" prompts.
6. **Energy audit** (new): "Last month: which task made hours disappear?
   Which did you keep putting off?" Two questions, behavioral.
7. **Environment scenarios** (new): team size / pace / ambiguity / management
   appetite as concrete either-or offers.
8. **Trajectory** (new): three years out — climb / switch ladders / same rung
   better terms / deliberately experimenting.
9. **Evidence drop** (exists): resume optional (synthesized cv.md path
   stays); later LinkedIn paste + portfolio links.
10. **Voice sample** (new, feeds the tailor): one real writing sample OR one
    answer written "like you'd text a friend." Stored to voice-profile.
11. **Metric honesty pass** (new, feeds the tailor): the model lists every
    number/claim it extracted; user marks each *confident* or *don't use*.
    This IS the anti-fabrication fence, made visible and user-owned.

**Phase III — the mirror moment (ship this no matter what):**
12. The system writes a two-paragraph "who you are professionally" synthesis,
    editable inline. Accepting it completes the profile and lands on a feed
    that is already populated and re-ranked. Emotional peak; the moment of
    trust.

**Living profile:** every save/dismiss/applied, every tailor edit, every
depth answer keeps refining the model (learned-insights + rubric reweights +
periodic recompiles). Onboarding never ends; it becomes ambient. The dossier
shows a change-log ("learned this from your last 20 dismissals").

## 3. The three verbs

**Hunter (live today).** Keeps the four-stage ladder. Gains: reaction-
calibration examples injected into rubric compile + verdict prompts;
module-completion re-ranks; reasons written against dossier lines.

**Tailor (next verb — owner decision: before submitter).** The Python tailor
already exists (LaTeX resume, cover letter, form answers). Web surface:
"Tailor this" on any match → side-by-side resume + cover letter where
**every claim carries a traceable source chip** (hover → the dossier line /
resume bullet it came from). Claims without sources cannot render — that is
how "never fabricate ANYTHING" becomes an interface property instead of a
promise. Voice sample drives tone. Metric honesty pass gates numbers.
Output: downloadable PDFs + copyable answers.

**Submitter (later verb — owner decision: browser extension).** The hosted
app cannot drive the user's machine. Phasing: ship tailor first; then a
browser extension that opens the listing, fills from the profile + tailored
materials, and **stops at final submission — the human clicks Submit,
always** (the founding rule carries over). The existing local Playwright
companion remains the operator's power tool; the retired hosted-browser
path stays retired.

## 4. Look, feel, voice

Owner decision: keep the name; evolve the look. Direction: "**a sharp
recruiter friend who actually listens**" — warm-dark editorial, not
dashboard-generic. Concretely: real typographic hierarchy (the v2 ramp was
the start; the dossier gets display-size moments), generous whitespace, the
amber used with intent (full-strength at moments of meaning), motion at
emotional beats only (module complete → visible re-rank; mirror moment
reveal), microcopy in one consistent voice (direct, warm, zero corporate
filler, zero exclamation marks — the existing ban-list grows into a voice
guide). No stock illustration. The dossier page is the flagship; design it
first, let its language propagate outward.

## 5. Architecture stance (evolution, not rewrite)

The v2 spine survives intact: `profiles.doc` 8-file contract, postings pool,
matches ladder, budget rails, invite/allowlist, admin. V3 changes are
additive: new intake modules write into the same doc files (values →
thesis; energy/environment/trajectory → thesis + rubric; voice → voice-
profile; metric pass → article-digest), reaction calibration gets one new
table (`posting_reactions`), and the linear stage machine generalizes to a
module-progress model (design pass to decide: extend the stage enum once
more vs. a `modules_completed` jsonb — favor the latter, one migration, no
more enum churn). Tailor reuses the existing Python package behind new
service endpoints; materials go to the existing storage bucket pattern.

## 6. Sequencing

- **Now:** nothing moves until after Saturday's friend test (v2 as shipped).
- **V3a — profile depth + dossier:** new intake modules + background-hunt
  checkpoint + mirror moment + the dossier page + living-profile plumbing.
- **V3b — tailor:** traceable-claims UI + PDF pipeline + voice/metric gates.
- **V3c — submitter extension** + LinkedIn/portfolio evidence + profile
  change-log polish.
Each phase = Fable design pass → Sonnet build waves → review-then-merge →
`vercel --prod`, per the established ritual (scrub gate, migration-number
pinning, budget ledger on every LLM turn).

## 7. Honest risks

- **Intake length:** ~20 min total even well-sequenced. Mitigation: the
  background hunt + visible re-ranks pay the user back mid-flow; friends are
  motivated users; measure completion drop-off per module from day one.
- **Onboarding cost:** more LLM turns (~$0.60–1.00 est. with reactions +
  mirror). Fine at friends scale; watch the ledger.
- **Traceability is hard to retrofit:** build the tailor's claim-source
  model from day one, never bolt on.
- **Extension is a real product surface** (store review, permissions,
  updates); do not underestimate V3c.
- **Narrative inference can overclaim:** the mirror moment and reasons must
  quote the user's own words back, not invent diagnoses — same never-
  fabricate rule, applied to the user themselves.
