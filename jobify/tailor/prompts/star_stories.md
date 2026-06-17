# STAR+R Story Generator

Generate **3 to 5 STAR+R interview stories** for the candidate grounded
in their actual profile and tailored to this specific job posting. Each
story must answer a behavioral question a hiring manager would plausibly
ask for THIS role.

The +R is *Reflection* — what they learned, what they'd do differently.
It turns a generic STAR into a story the interviewer remembers.

The CANDIDATE PROFILE (thesis.md canonical-first) and VOICE PROFILE are
in the system prompt.

CHOSEN ARCHETYPE (lean these stories toward this lane):
{archetype_block}

JOB POSTING:
Title: {job_title}
Company: {company}
Description: {job_desc}

GROUND RULES:

1. **Only stories grounded in real experience.** Pull from the roles,
   projects, and work described in the candidate's CV and profile. Do
   NOT invent companies, projects, dates, or metrics.
2. **Reflection must be honest.** It's the highest-trust part of the
   story — what they learned, what they'd do differently, what surprised
   them. Avoid faux-humility ("I learned to be a better team player").
   Specific reflections only: name the concrete thing they would change
   and the concrete consequence it would have prevented.
3. **Tags should be searchable.** Include archetype, key skills/tools
   surfaced (drawn from the CV, e.g. specific languages, frameworks, or
   platforms), and behavioral-question category ("conflict", "ambiguity",
   "leadership-without-authority", "deadline-pressure").
4. **Each story ~80-150 words across STAR fields.** Reflection 30-60
   words.
5. **Output strict JSON only.** No prose, no code fences.

Respond with a JSON object of the form:

```
{{
  "stories": [
    {{
      "situation": "...",
      "task": "...",
      "action": "...",
      "result": "...",
      "reflection": "...",
      "tags": ["...", "..."]
    }}
  ]
}}
```
