# Generate Form-Answer Drafts (M-1, career-ops "Block H")

You are drafting answers for the standard fields of a job application
form. These drafts are persisted to the `jobs.form_answers` JSONB column
and become the **authoritative source** that downstream code uses to:

  - fill in DOM-based per-ATS handlers (Greenhouse, Lever, Ashby) — the
    handlers read `form_answers` directly, no LLM call at fill time.
  - render copy-paste material in the dashboard review cockpit.
  - feed the vision-based fallback agent's system prompt for unknown
    ATSes so it doesn't have to OCR identity fields.

Identity, contact, location, compensation, work-authorization, and
current-employment fields are ALREADY filled from `profile.yml` in
Python before you were called. Do NOT regenerate them — they are shown
below for context only. Inventing or "improving" any of these is a hard
failure. Phone numbers, emails, salary numbers, and start dates that
are not in the identity block must NOT appear in your output.

Your job is to produce four narrative outputs:

  - `why_this_role` — string, <=120 words. Archetype-specific framing.
    Must reference a specific phrase or requirement from the JD itself
    so the reader can tell the answer was written for this posting and
    not template-recycled. Lead with what the candidate has built that
    maps to the role; close with why they want this specific work next.
  - `why_this_company` — string, <=100 words. Must reference something
    specific about the company — its product, its mission, a signal
    from the JD about how the team works. Generic praise ("great
    company", "exciting mission") is forbidden.
  - `additional_info` — string OR null, <=150 words. Emit a string
    ONLY when the JD explicitly raises a specific challenge that maps
    cleanly to one of the candidate's proof points from the CV (a
    direct, named match between a JD requirement and real experience).
    Otherwise emit `null`. Do not pad — silence is fine.
  - `additional_questions` — list of objects of shape
    `{{"question": "...", "draft_answer": "..."}}`, one per
    role-specific question the JD explicitly asks. Examples that
    count: "Why are you interested in this role?", "Describe a time
    you...", "What's your experience with X?". If the JD doesn't
    list any such questions, emit an empty list `[]`. Each draft
    answer <=200 words and must follow the same honesty + voice +
    anti-slop rules as the rest of this prompt.

CONTEXT — IDENTITY ALREADY FILLED IN (do not regenerate or echo back):
```
{identity_summary}
```

The CANDIDATE PROFILE (thesis.md canonical-first) and VOICE PROFILE are
in the system prompt.

CHOSEN ARCHETYPE (use this lane's framing, emphasis points, and tone
for `why_this_role`):
{archetype_block}

{degree_gate_block}

RESUME TAILORING CONTEXT (stay consistent with these choices — the
reviewer will read both the resume and the form draft):
{resume_context}

JOB POSTING:
Title: {job_title}
Company: {company}
Description: {job_desc}
Tier: {tier} (1 = dream-job lane, 2 = secondary lane, 3 = mission ML/CV; see thesis.md)

WRITING RULES — follow strictly:

1. ANTI-SLOP: inherit `_shared.md`'s banned-phrase list verbatim. No
   "passionate", no "leverage", no "spearhead", no "synergies", no
   "robust", no exclamation marks, no "I am writing to". Any sentence
   that could appear in another candidate's form answer unchanged is
   slop — rewrite with something specific to the candidate's history.
2. ARCHETYPE FRAMING: for `why_this_role`, lead with whatever the
   chosen archetype emphasizes. When personal projects ARE the relevant
   experience lane for this role, describe the most relevant one
   concretely as a running system the candidate designed and operates —
   its stages, the evidence behind it, how it works end to end — never
   as "an AI project". The candidate's distinctive depth (whatever the
   thesis/CV establishes) is the secondary differentiator.
3. HONESTY: never claim experience the candidate doesn't have. If a
   question asks about something they haven't done, draft an answer that
   names the closest real experience from the CV and acknowledges the
   gap directly. ("I haven't shipped X in production, but at <employer> I
   did Y, which carries the same constraints.") For partial-fit roles
   where the candidate has no formal title in the lane: do NOT pretend
   they have it; frame the closest real CV experience as the honest
   parallel.
4. SPECIFICITY: concrete tools, named projects, measured outcomes.
   "Cut p95 latency from 2.1s to 380ms" beats "improved performance".
   A named deployment with a measured outcome beats "worked on
   hardware".
5. VOICE: conversational, technical, contractions OK, hedges where
   natural ("sort of", "honestly", "pretty much"). No corporate
   language. No exclamation marks anywhere.
6. ASCII ONLY: no em-dashes, en-dashes, or smart quotes — ATS parsers
   choke on them. Use plain hyphen-minus and straight quotes.
7. LENGTH DISCIPLINE: respect the per-field caps above. A short
   honest answer beats a padded one.

OUTPUT FORMAT — return STRICT JSON, no preamble, no trailing prose,
no markdown code fences. Example shape (use null and [] when
appropriate):

{{
  "why_this_role": "...",
  "why_this_company": "...",
  "additional_info": null,
  "additional_questions": []
}}
