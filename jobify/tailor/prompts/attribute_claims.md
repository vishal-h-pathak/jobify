# Attribute Claims (Cover Letter)

You already wrote the cover letter below for this candidate. Your job now
is different: go back over it sentence by sentence and, for every sentence
that asserts a fact about the candidate, cite the exact passage in their
CV that backs it up. This is the safety check that keeps a fabricated
claim from ever reaching the candidate's actual application — treat it
that way, not as a formality.

The CANDIDATE PROFILE (thesis.md canonical-first) and VOICE PROFILE are
in the system prompt; the profile there includes the same cv.md and
article-digest.md content reproduced below for convenience.

FINISHED COVER LETTER (attribute this exact text — do not rewrite it):
{cover_letter_text}

CANDIDATE'S MASTER CV (markdown) — the source you cite passages from:
{cv_markdown}

YOUR TASK — split the cover letter above into sentence units, in order,
and classify each one:

1. SPLIT: Break the letter into individual sentences, in reading order.
   Keep each sentence's text verbatim (copy it exactly as written in the
   letter above — do not paraphrase, trim, or fix punctuation).

2. CLASSIFY each sentence as one of:
   - "cl_sentence" — the sentence asserts something factual about the
     candidate: a company name, a technology, an outcome, a number, a
     job title, something they built or did. Anything a reader could
     fact-check against the CV.
   - "voice" — pure connective or transitional prose that asserts no
     fact at all: framing, tone-setting, or motivational language (e.g.
     "I think this role makes sense for me right now" or "Here's why
     that connects."). If the sentence names a technology, employer,
     number, or outcome, it is NOT voice — classify it "cl_sentence"
     even if it also does some framing work.

3. CITE sources for every "cl_sentence" unit. Each source is
   `{{"file": "cv.md", "quote": "..."}}` (or `"article-digest.md"` instead
   of `"cv.md"` when the fact is a specific metric confirmed there rather
   than in the CV body). The quote MUST be copied character-for-character
   from the source document — this is checked by exact substring match,
   not by meaning, so a paraphrased or reworded quote will fail
   verification even if it's an accurate paraphrase. Copy-paste the
   passage; do not summarize it.

   Example: if the CV contains the line
   `- Cut inference latency from 2.1s to 380ms on Jetson Orin`
   and the cover letter sentence says "I got inference down to 380ms on
   Jetson Orin," the correct source is:
   `{{"file": "cv.md", "quote": "Cut inference latency from 2.1s to 380ms on Jetson Orin"}}`
   — the full line as it literally appears in the CV, not a fragment you
   composed to match the sentence's wording.

   A "cl_sentence" can cite more than one source if it draws on multiple
   passages. "voice" units carry no "sources" (omit the field or leave it
   an empty list).

4. IDs: number the sentences in order starting at 0, using the id scheme
   `cl.s0`, `cl.s1`, `cl.s2`, ... — one id per sentence, no gaps, no
   reordering.

Respond with valid JSON only, no markdown, in exactly this shape:
{{
    "units": [
        {{
            "id": "cl.s0",
            "kind": "cl_sentence",
            "text": "The exact sentence text, verbatim from the letter.",
            "sources": [
                {{"file": "cv.md", "quote": "exact verbatim passage from cv.md"}}
            ]
        }},
        {{
            "id": "cl.s1",
            "kind": "voice",
            "text": "A connective sentence asserting no fact.",
            "sources": []
        }}
    ]
}}

Include every sentence from the letter, in order, with no omissions and
no additions. Do not editorialize, do not add commentary outside the
JSON, and do not alter the sentence text from what's written in the
letter above.
