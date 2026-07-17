# Tailor LaTeX Resume

You are tailoring a LaTeX resume for the candidate for a specific job
application. Your job is to SELECT and REORDER content to best match the
target role. You may rewrite bullet points to emphasize relevant aspects,
but you MUST NOT fabricate experience, skills, or projects the candidate
doesn't have.

The CANDIDATE PROFILE (thesis.md canonical-first) and VOICE PROFILE are
in the system prompt.

CANDIDATE'S MASTER CV (markdown) — the complete, factual source you
SELECT and REORDER from; never fabricate beyond it:
{cv_markdown}

TAILORING GUIDANCE (from earlier analysis):
{tailoring_json}

TARGET JOB:
Title: {job_title}
Company: {company}
Description: {job_desc}
{match_chat_block}

CHOSEN ARCHETYPE (J-4 — bias project selection + skill ordering toward
this lane. Same candidate, different framing):
{archetype_block}

CHOSEN ARCHETYPE applies to project + skill ordering only; never invent
content not present in the CV above.

CITATIONS: every bullet, every skills-category value, and the optional
summary_line must ALSO be backed by a "sources" array citing the exact
cv.md passage(s) it's drawn from — this is what lets a deterministic
checker confirm nothing here was invented. Each source is
`{{"file": "cv.md", "quote": "..."}}`; the quote MUST be copied
character-for-character from the CANDIDATE'S MASTER CV above — this is
checked by exact substring match, not by meaning, so a paraphrased or
reworded quote fails verification even if it's an accurate paraphrase.
Example: if the CV contains the line
`- Cut inference latency from 2.1s to 380ms on Jetson Orin` and you
write the bullet "Reduced inference latency from 2.1s to 380ms," the
correct source is
`{{"file": "cv.md", "quote": "Cut inference latency from 2.1s to 380ms on Jetson Orin"}}`
— the full line as it literally appears in the CV, not a fragment
composed to match your rewrite. A bullet/category/summary_line can cite
more than one source if it draws on multiple passages. Experience
headers (org/title/location/period) and education entries do NOT need
citations — those are checked directly against the CV text structurally.

These citations ride in three NEW, additive top-level/nested fields —
they do not change the shape of "skills", "bullets", or "summary_line"
themselves, they sit alongside them (see the JSON example at the end):

- "skills_sources" — a top-level dict, same keys as "skills", each value
  an array of sources backing that category's skills.
- "bullet_sources" — inside each project (alongside "bullets"), an array
  the SAME LENGTH and SAME ORDER as that project's "bullets", where
  `bullet_sources[j]` is the sources array for `bullets[j]`.
- "summary_sources" — a top-level array of sources backing
  "summary_line" (omit or leave empty if "summary_line" is null).

YOUR TASK — respond with a JSON object containing:

1. "skills" — a dict of 4-5 skill categories with comma-separated skills.
   Rewrite category names and reorder skills to lead with what's most relevant.
   Only include skills the candidate actually has from the CV above.
   Also fill in "skills_sources" (see CITATIONS above) with one entry
   per category, same keys as "skills".

   You have flexibility on category names — the resume's two-column
   skills layout auto-sizes the left column to fit the longest label
   you pick (up to ~32 characters), so you don't need to artificially
   compress descriptive names. That said, terse labels (1–3 words)
   read better at a glance; use longer phrasing only when the extra
   words actually help frame the skills for this role.

2. "skills_layout" (optional) — one of "auto" (default), "compact",
   "wide", or "stacked". Leave it out (or set to "auto") in almost all
   cases — the renderer will pick a width that fits your labels.
   - "compact" forces the original tight 4.5cm left column. Pick this
     only when you've deliberately chosen short labels and want a
     wider value column.
   - "wide" forces the maximum 7.0cm two-column layout. Useful if
     your labels are right at the boundary and you want to err on
     the side of not wrapping.
   - "stacked" puts each category label on its own line above its
     skills value. Reach for this only if you've intentionally
     chosen very long descriptive labels (>32 chars) or have many
     categories where readability suffers in a table.

3. "experience" — a list of experience entries drawn from the CV. Each entry has:
   - "org", "title", "location", "period" (keep these factual, from the CV)
   - "projects" — list of projects to INCLUDE (you can drop irrelevant ones).
     Each project has "name" (use null when a role has no distinct project name),
     "period", "bullets", and "bullet_sources" (see CITATIONS above —
     same length/order as "bullets").
     You may rewrite bullets to emphasize relevant aspects, but keep them factual.
     Lead with the most relevant projects for this role. Include the most recent and
     most relevant roles from the CV; do not fabricate employers or projects.

4. "education" — a list of objects extracted from the CV, each of shape
   {{"school": ..., "degree": ..., "period": ...}}. Pull these from the CV's
   education section; do not invent schools, degrees, or dates.

5. "summary_line" — optional 1-line summary to add below the header (or null to skip).
   If included, write it in the candidate's voice: direct, technical, no fluff.
   Fill in "summary_sources" (see CITATIONS above) alongside it.

ONE PAGE IS MANDATORY. The resume MUST fit on a single page. Budget the
content so it does — a downstream trim loop will mechanically drop bullets
if you overflow, but it can only cut, so anything past these caps just gets
deleted (losing content you chose). Target one page directly:
- Show at most 3 experience entries (projects) total across all employers,
  ordered most-relevant first.
- At most 4 bullets per entry.
- Each bullet ≤ 2 printed lines (roughly ≤ 200 characters).
- The optional "summary_line" is ≤ 2 lines, or null (omit it when in doubt).
- Keep skills compact: 4-5 categories, comma-separated.

RULES:
- Always include the candidate's most recent role and the most relevant prior roles; drop
  roles or projects that add nothing for this specific posting.
- Rewrite skill categories to match the job posting's language where honest.
- Bullets should be specific and technical. No vague claims.
- Keep the resume to 1 page worth of content — see the mandatory caps above.
- Do NOT add projects, employers, or skills that don't exist in the CV above.

Respond with valid JSON only, no markdown, in exactly this shape (the
"sources" fields are the additive citation arrays described above —
everything else is the existing contract, unchanged):
{{
    "skills": {{
        "Category Name": "skill1, skill2, skill3"
    }},
    "skills_sources": {{
        "Category Name": [
            {{"file": "cv.md", "quote": "exact verbatim passage from cv.md"}}
        ]
    }},
    "skills_layout": "auto",
    "experience": [
        {{
            "org": "Employer, from the CV",
            "title": "Title, from the CV",
            "location": "Location, from the CV",
            "period": "Period, from the CV",
            "projects": [
                {{
                    "name": "Project name or null",
                    "period": "Period, from the CV",
                    "bullets": [
                        "Rewritten bullet 1",
                        "Rewritten bullet 2"
                    ],
                    "bullet_sources": [
                        [{{"file": "cv.md", "quote": "exact verbatim passage backing bullet 1"}}],
                        [{{"file": "cv.md", "quote": "exact verbatim passage backing bullet 2"}}]
                    ]
                }}
            ]
        }}
    ],
    "education": [
        {{"school": "School, from the CV", "degree": "Degree, from the CV", "period": "Period, from the CV"}}
    ],
    "summary_line": "Optional 1-line summary in the candidate's voice, or null",
    "summary_sources": [
        {{"file": "cv.md", "quote": "exact verbatim passage backing the summary line"}}
    ]
}}
