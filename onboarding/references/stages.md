# Interview stages — full script

The detail behind the seven stages in `SKILL.md`. Run them in order. The goal of
each is the **content** that fills one or more output files (see
`file-templates.md`). Interview conversationally — ask, listen, probe, reflect
back — don't read these as a questionnaire.

A running principle: **specifics beat completeness.** One real metric the user
can defend in an interview is worth more than five vague ones. When the user
gives you a generic answer ("I improved performance"), push once for the
concrete ("from what to what? measured how?"). If they don't have it, that's a
"do not invent" entry, not a number to round up.

---

## Stage 1 — Resume ingestion

**Goal:** a structured, user-corrected dump of their real history → spine of
`cv.md` (and raw material for stages 5 and 6).

1. Read the uploaded resume. For PDF/DOCX, prefer any repo PDF/DOCX tooling; a
   plain text extraction is fine — you can read extracted text directly. If they
   pasted text, use that.
2. Extract and reflect back, as a structured summary:
   - Each role: employer, title, location, start–end dates, 2–5 bullets.
   - Education (degrees, institutions, years) — note if a degree is **absent**
     (feeds the degree-gate in stage 3).
   - Skills (languages, tools, domains) — keep only defensible ones.
   - Every **metric** mentioned (numbers, percentages, scale, dollar figures).
3. Ask the user to correct anything wrong or stale, and to flag any metric that
   is approximate vs hard. Hold onto the corrected structure for later stages.

**Degrade gracefully:** no resume? Interview the work history verbally and build
`cv.md` from the conversation. A sparse resume just means more questions here.

---

## Stage 2 — Identity & logistics

**Goal:** `identity`, `location_and_compensation`, and the complete
`application_defaults` block in `profile.yml`. These are the PII the submit
pre-fill types into real application forms, so they must be accurate and
form-ready.

**Identity** (→ `identity:`):
- `name` (required), `email` (required), `phone`, `location_base`,
  `linkedin`, `website`, `github`. Phrase exactly as they'd want them on a form.

**Logistics** (→ `location_and_compensation:`):
- Home base; whether fully-remote is acceptable; in-person/hybrid stance;
  relocation stance; current total comp; target comp band (a string, e.g.
  `"120000-140000"`). Be honest about the band — too wide surfaces roles they'll
  reject; the scorer floors roles that violate these.

**Application defaults** (→ `application_defaults:`) — ask for **all seven**, none
optional. Every key is read by `jobify/submit/adapters/_common.py::applicant_fields`:

| Key | What to ask | Notes |
|---|---|---|
| `work_authorization` | "Are you authorized to work in [country]? What's your status?" | e.g. `us_citizen`, `permanent_resident`, `visa_holder`, `needs_sponsorship` |
| `visa_sponsorship_needed` | "Do you need visa sponsorship now or in future?" | boolean |
| `earliest_start_date` | "How soon could you start?" | free text, form-ready |
| `relocation_willingness` | their relocation stance in their own words | free text |
| `in_person_willingness` | remote / hybrid / in-person preference | free text |
| `ai_policy_ack` | "Some forms ask about AI-assistance use — what's your honest standing statement?" | free text; keep human-in-the-loop |
| `previous_interview_with_company` | "Interviewed anywhere you're targeting before?" | map of `slug: bool`; start `{}` if none |

If they don't have an `ai_policy_ack` ready, offer the neutral one from
`profile.example/profile.yml` as a starting point and let them edit it.

---

## Stage 3 — Targeting

**Goal:** `what_he_is_looking_for` (tiers) in `profile.yml`, the judgment in
`thesis.md`, and `disqualifiers.yml`.

1. **Tiers.** "Describe your ideal role. Now: what would you take that's good but
   not the dream? What's the floor you'd still consider?" Capture as `tier_1` /
   `tier_2` / `tier_3` (a short `label` each, optional `notes`,
   `reference_role`). One tier is fine if that's the truth.
2. **Dream companies / industries.** Names and, more importantly, the *why*
   (what about them is attractive). The why generalizes; the names are
   calibration anchors, not an allowlist. Reused in stage's portals seeding.
3. **Hard disqualifiers.** The absolute "no"s — domains, role shapes, locations,
   comp floors. → `disqualifiers.yml: hard_disqualifiers`.
4. **Soft concerns.** Yellow flags that lower a score but don't auto-reject. →
   `disqualifiers.yml: soft_concerns`.
5. **Degree gate.** "Any roles your education rules out for you?" e.g. no PhD →
   no postdoc/professor/PhD-program roles. Record it as a hard constraint in
   `thesis.md` and, if it's an absolute no, in `hard_disqualifiers`.

`thesis.md` is the JUDGMENT document — the scorer reads it FIRST and it overrides
other profile prose. Write it in the user's voice as if briefing a friend
screening jobs for them: a one-paragraph thesis, hard constraints, tiers, energy
signals (JD language that's a strong + or −), optional named-company anchors,
optional tone notes. See `file-templates.md` and `profile.example/thesis.md`.

---

## Stage 4 — Voice elicitation (from REAL samples)

**Goal:** `voice-profile.md` — how this person actually writes, so the tailor's
cover letters and bullets sound like them, not like ATS slop.

1. **Get real text.** Ask for at least one substantial sample: an old cover
   letter, a meaty Slack/email message, a blog paragraph, a README they wrote.
   **Insist on at least one.** If they genuinely have nothing, ask them to write
   one paragraph live: *"Explain your best project to a smart friend who doesn't
   know your field."* Use that.
2. **Derive patterns from the sample, not a template.** Read it and name what's
   actually there:
   - Sentence length and rhythm; formal vs conversational; contractions?
   - How they describe their own work — owned/built vs spearheaded/drove?
   - Buzzword tolerance; hedging; humor; how they handle uncertainty.
   - What they conspicuously *don't* do.
3. Write the file as concrete do/don't rules grounded in the sample, under the
   `## ` sections the loader and tailor expect: **How He Communicates**, **What
   NOT to Do**, **What TO Do**, **Cover Letter Guidelines**, **Resume
   Guidelines**. (At least one `## ` heading is required or the loader's
   `sections` dict is empty.)

**Degrade gracefully:** sparse sample → fewer, safer rules, and say so in a
comment. Never fabricate a distinctive voice from nothing; a plain, honest
voice profile beats an invented persona.

---

## Stage 5 — Proof points

**Goal:** `article-digest.md` — `claim → evidence` proof points plus the
confident-metrics / do-not-invent split.

1. Walk each significant resume bullet → a proof point: the claim, the evidence
   (system, scale, outcome), and *when to cite it* (which kind of JD).
2. Sort every number into one of two lists:
   - **Metrics we are confident about** — defensible, safe to cite verbatim.
   - **Metrics we DO NOT have (do not invent)** — the explicit fence. Anything
     fuzzy, half-remembered, or aspirational goes here so the tailor never
     fabricates it.
3. Keep numbers consistent with `cv.md` (a drift checker compares them). If a
   number differs between resume and memory, ask which is right and fix both.

This file is the anti-fabrication guardrail. Err toward the do-not-invent list.

---

## Stage 6 — Archetypes

**Goal:** the `archetypes:` block in `profile.yml` — 1–N **framing lanes** the
tailor picks between per job.

1. Derive lanes from the tiers in stage 3. A lane is a distinct way to position
   the same person (e.g. "platform engineer" vs "developer-facing/solutions").
   2–4 is plenty; one is fine if the targeting is narrow.
2. Each archetype (snake_case key) supports: `label` (required), `framing`,
   `emphasis_proof_points` (lead-with experiences), `tone_guidance`,
   `bullet_template` (a fill-in pattern + example). Make `framing` distinct
   enough that the classifier can tell lanes apart.
3. Tie every lane to **real** strengths and proof points from stages 1/5 — no
   aspirational lanes the person can't back up. If a tier is a genuine pivot
   (e.g. into sales engineering), have the framing acknowledge it candidly.

See `profile.example/profile.yml` for three worked archetypes.

---

## Stage 7 — Resume template pick

**Goal:** record the user's template choice in `profile.yml`.

1. List the ATS-safe gallery in `jobify/resume_templates/` (`classic`, `modern`,
   `compact`, `accent`, `executive` — see that package's `README.md`).
   Briefly describe each (layout, density, who it suits).
2. Let the user pick one. Record it as a top-level `resume_template:` in
   `profile.yml`, value = the template id (e.g. `modern`).
3. If omitted, the tailor falls back to the per-archetype default, then
   `classic`.
