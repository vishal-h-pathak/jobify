# Generate Cover Letter

You are writing a cover letter for the candidate. This is the most
important instruction: the letter must sound like the candidate wrote it
themselves — not like an AI, not like a career coach, not like a
template. Read the voice profile carefully and match their tone exactly.

The CANDIDATE PROFILE (thesis.md canonical-first) and VOICE PROFILE are
in the system prompt. Read the voice profile carefully and match their
tone exactly.

JOB POSTING:
Title: {job_title}
Company: {company}
Description: {job_desc}
Job Tier: {tier} (1=dream-job lane, 2=secondary lane, 3=mission ML/CV; see thesis.md)
{context}
{match_chat_block}

CHOSEN ARCHETYPE (J-4 — frame the cover letter through this lane. The
opening + middle paragraphs should lead with the emphasis points below
rather than other parts of their history):
{archetype_block}

{degree_gate_block}

WRITING RULES — follow these strictly:

1. TONE: Write like the candidate explaining to a smart friend why this role makes sense for
   them. Conversational, technically precise, no corporate language. Use contractions. Use hedges
   where natural ("sort of", "pretty much", "honestly"). Be direct about motivations.

2. STRUCTURE:
   - Opening: What the company/role is doing and why it connects to their actual work history.
     One specific technical thread, not a generic hook. Never open with "I am writing to..."
     or "I was excited to see..." — start with the work itself.
   - Middle: 2-3 concrete things they built or did that are directly relevant. Include enough
     technical detail to be credible. Frame as narrative ("At <employer>, I spent two years..."),
     not bullet points or claims ("I have extensive experience in...").
   - Close: Why the timing makes sense and a low-key, direct call to action. Not "I would
     welcome the opportunity to discuss" — more like "Happy to talk through any of this."

3. THINGS THAT MUST NOT APPEAR (in addition to the global anti-slop list):
   - "I am confident that"
   - Any sentence that could appear in any other candidate's cover letter unchanged
   - Exclamation marks (zero of them)

4. LENGTH: 3-4 paragraphs, under 350 words. Every sentence earns its place.

5. HONESTY: Do NOT fabricate experiences or skills. If the role asks for something they
   don't have, don't address it. Focus on what's genuinely relevant.

6. ARCHETYPE FRAMING: Lead with whatever the chosen archetype emphasizes. When personal
   projects ARE the relevant experience lane for this role, describe the most relevant one as
   a concrete, running system the candidate designed and operates — what its stages are, the
   evidence behind it, how it works end to end. Never call it "a side project" — describe what
   it does. Then bring in the candidate's distinctive depth (whatever their thesis/CV
   establishes) as the differentiator.

7. ROLE-TYPE AWARENESS: For partial-fit roles (a lane where the candidate has no formal title
   but has adjacent real experience), DO NOT pretend they have the title. Instead, draw the
   honest parallel from real CV experience and frame it through the role's lens. The cover
   letter should acknowledge a career pivot candidly when there is one, grounded in what the
   candidate has actually done.

Output the cover letter text only, no preamble or sign-off formatting.
