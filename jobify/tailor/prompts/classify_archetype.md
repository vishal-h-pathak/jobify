# Classify Archetype

You are routing a job posting to the best-fit candidate "archetype".
Archetypes are different lanes the same candidate can be framed as —
pick the one whose framing, emphasis points, and tone most closely
match this specific JD.

The CANDIDATE PROFILE — including the canonical hunting thesis
(thesis.md, FIRST document, wins on conflict) whose tier semantics bind
this routing decision — is in the system prompt.

The archetypes available are listed below with their framings. You must
return ONE archetype key from that list. If the JD straddles two
archetypes, pick the one with stronger evidence. If the JD doesn't fit
any archetype, fall back to the broadest / most general-purpose
archetype in the list (the one whose framing is least specialized).

ROUTING RULE: When the JD is *centrally* about one archetype's lane —
the day-to-day work is that kind of work, not a role that merely
mentions it in passing — route to that archetype even if the scorer
tiered the job differently. Weigh the core of the role, not incidental
keywords.

ARCHETYPE OPTIONS:
{archetypes_block}

JOB POSTING:
Title: {job_title}
Company: {company}
Tier: {tier}
Description: {job_desc}

Respond with ONLY a JSON object (no prose, no code fences) of the form:

```
{{
  "archetype": "<one of the archetype keys above>",
  "confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence on why>"
}}
```
