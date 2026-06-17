# Tailor Resume

You are tailoring a resume for the candidate. The resume must be strictly
professional — no personal statements, no interests section, no
"passionate about" language. Every bullet should describe something
concrete that was built, deployed, or shipped.

The CANDIDATE PROFILE (thesis.md canonical-first) and VOICE PROFILE are
in the system prompt. Use the voice profile for the tone of the summary
only.

JOB POSTING:
Title: {job_title}
Company: {company}
Description: {job_desc}
Job Tier: {tier} (1=dream-job lane, 2=secondary lane, 3=mission ML/CV; see thesis.md)
{match_chat_block}

CHOSEN ARCHETYPE (J-4 — bias your framing, emphasis areas, and bullet
rewrites toward this lane. The candidate is the same person; the
archetype is which side of their work to lead with):
{archetype_block}

RESUME RULES — follow these strictly:

1. SUMMARY: 2-3 sentences max. Written in the candidate's voice — technically precise, no fluff.
   Lead with what they do, the domain, and years of experience (pull all of this from the CV).
   Do not include "passionate", "driven", or any soft descriptors.
   Example tone (structure only — fill from the actual CV): "<discipline> engineer with N+ years
   across <domains>. Most recent work at <employer> doing <specific recent work>."

2. EMPHASIS AREAS: Pick the 3-5 skills/experiences from their background that most directly
   match the job requirements. Only include things they actually have.

3. KEYWORDS: Mirror specific terms from the job posting that the candidate genuinely has
   experience with. If the posting names a technology they've actually used, include it. If the
   posting names one they haven't used, do NOT include it.

4. EXPERIENCE ORDER: Reorder their roles so the most relevant work appears first. Always include
   the most recent role and the most relevant prior roles from the CV. Personal projects can be
   included in a "Projects" section if they're relevant to the role.

5. BULLET STYLE: Each experience bullet should follow the pattern:
   [Action verb] + [specific thing built/done] + [tools/tech used] + [measurable outcome if available]
   Example structure: "Deployed <system> on <platform> for <purpose>, achieving <measured outcome>."

6. DO NOT fabricate experiences, skills, certifications, or metrics they don't have.

7. ARCHETYPE FRAMING: Lead with the side of the candidate's work that matches the chosen
   archetype and the JD. When personal projects ARE the relevant experience lane for this role
   (e.g. the JD is centrally about a kind of system the candidate has built on their own), give
   the most relevant project a Projects entry near the top and describe it concretely as a
   running system — stages, gates, data flow — never as "a side project". Bring in the
   candidate's distinctive depth (whatever their thesis/CV establishes) as the differentiator.

8. HONEST GAP FRAMING: When the role is a partial fit (e.g. a lane where the candidate has no
   formal title but has adjacent real experience), do NOT pretend they have the title. Instead,
   surface the closest genuine experience from the CV and frame it through the role's lens
   honestly. Emphasize transferable, demonstrable strengths the CV actually supports.

Respond in JSON format. For "suggested_bullets", use the candidate's real org/employer names
from the CV as keys (most relevant roles first), plus an optional "Projects" key:
{{
    "tailored_summary": "2-3 sentence summary in the candidate's voice",
    "emphasis_areas": ["specific skill or experience area to highlight"],
    "keywords_to_include": ["job posting terms that genuinely match their background"],
    "experience_order": ["role/org to list first, second, etc."],
    "suggested_bullets": {{
        "<org from CV>": ["rewritten bullet 1", "rewritten bullet 2"],
        "<another org from CV>": ["rewritten bullet 1"],
        "Projects": ["optional relevant project bullets"]
    }},
    "skills_section": {{
        "category_name": ["skill1", "skill2"]
    }},
    "diff_notes": "Brief description of what changed from a general resume and why"
}}
