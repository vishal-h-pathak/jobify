# Task 2 report — `jobify/tailor/claims.py`: deterministic claims verifier

## Files touched (ownership fence honored)

- `jobify/tailor/claims.py` (new)
- `tests/test_claims.py` (new)

No other files touched. (Note: this report file previously contained stale content from an
unrelated earlier session — "dossier change-log: parse learned-insights.md insight lines" — that
had nothing to do with V3B S1 task 2. Overwritten with this task's actual report.)

## Public API (what Task 5 — the worker orchestrator — should call)

```python
from jobify.tailor.claims import verify_claims, drop_unverified

result = verify_claims(
    proposed_units,          # list[dict] — the LLM's proposed claim units
    cv_text=cv_text,         # str — materialized cv.md contents
    article_digest_text=article_digest_text,  # str — materialized article-digest.md
    doc_sha256=doc_sha256,   # str — caller computes this over the pinned snapshot
)
# result == {"version": 1, "doc_sha256": ..., "units": [...], "dropped": [...]}

renderable_ids = drop_unverified(result)  # set[str] of unit ids that should actually render
```

Both functions are pure — zero LLM calls, zero I/O, zero Supabase/profile_loader access. The
caller (Task 5) is responsible for reading `cv_text`/`article_digest_text` from the materialized
profile dir and computing `doc_sha256` before calling `verify_claims`.

### Proposed-unit shape (input)

Every element of `proposed_units` is a plain dict:

```python
{
  "id": "r.exp0.b2",              # stable: surface.section.index — see ID convention below
  "surface": "resume" | "cover_letter",
  "kind": "bullet" | "skill" | "header" | "edu" | "summary" | "cl_sentence" | "voice",
  "text": "...",                  # required for bullet/skill/summary/cl_sentence/voice;
                                   # NOT used for header/edu (they use "fields" instead)
  "sources": [{"file": "cv.md", "quote": "..."}],   # rule 2 — omit/empty for header/edu
  "fields": {...},                # header: {org, title, location, period}
                                   # edu:    {school, degree, period}
}
```

`kind` distinguishes `"cl_sentence"` (a factual CL sentence, must cite like a resume bullet) from
`"voice"` (a connective, non-factual CL sentence from the attribution call — see the voice
exemption below). Header/edu units carry structural facts under `fields` rather than free-text +
sources, since rule 3 needs no citation.

### ID convention (Task 5 must mint ids this way for `drop_unverified`'s cascade to work)

- experience header: `r.exp{i}.header`
- experience bullet: `r.exp{i}.b{j}`
- education entry: `r.edu{i}`
- skill category: `r.skill{i}`
- summary line: `r.summary`
- cover-letter sentence: `cl.s{i}` (kind `cl_sentence` or `voice`)

`drop_unverified` pattern-matches only the `r.exp{i}.header` / `r.exp{i}.b{j}` shapes for its
cascade; every other id passes through untouched.

### Output shape (`claims.json`, matches §2.1 exactly)

```python
{
  "version": 1,
  "doc_sha256": "...",
  "units": [{..., "numbers": [{"token": "40%", "basis": "confirmed_metric"|"cv_span"}], "status": "verified"}],
  "dropped": [{"id": "...", "text": "...", "reason": "number_not_confirmed"|"missing_span"|"new_entity"}],
}
```

**Important judgment call for Task 5**: `verify_claims` only ever assigns `status: "verified"` to
a surviving unit, or drops it. It never assigns `"user_edited"` (set later by the inline-edit
flow, §2.5) or `"voice"` as a *status* value — `"voice"` only appears as a `kind`, never a
`status`, in this function's output. A unit's `kind` field is otherwise passed through unchanged
from the proposed input, **except** when a `kind: "voice"` unit trips the voice exemption and gets
reclassified — in that case the emitted unit's `kind` is rewritten to `"cl_sentence"` (see below),
so downstream rendering doesn't keep advertising a sourced sentence as "exempt from sourcing".

Header/edu units in `units[]` do not get a `numbers` key (rule 1 doesn't apply to them at all).

## The three rules, as implemented

**Rule 1 — numbers (`_verify_numbers` / `extract_numeric_tokens`).** Regex-extracts numeric
tokens from unit text: `%`, `$` amounts (`$5M`, `$200k`), multipliers (`3x`), durations glued to a
unit with no space (`2.1s`, `380ms`), and bare counts (`14`). A range like `"2.1s to 380ms"` needs
no special case — `finditer` just yields both tokens independently. Each token must appear
verbatim (boundary-safe substring, ASCII/whitespace-normalized) in either the `## Confirmed
metrics` section of article-digest.md (basis `"confirmed_metric"`) or the unit's own cited cv.md
quote (basis `"cv_span"`) — checked in that priority order, so a token confirmed in both records as
`"confirmed_metric"`. Any token found in `## Never use` fails immediately regardless of a valid
cv.md span. A single failed token drops the **whole unit**.

One regex subtlety worth flagging: the bare-count alternative is guarded with
`(?<![A-Za-z0-9])` so it doesn't fire on digits glued to a preceding letter/digit — e.g. `"p95"`
(a percentile) or `"RT-DETRv2"` (a model name) are identifiers, not citable counts. Without the
digit half of that lookbehind, a blocked match at `"9"` in `"p95"` would just retry one character
later and spuriously extract `"5"` as its own bare count — caught this via a failing test during
development (`test_number_confirmed_via_cv_span_passes` initially failed on `"p95"` in "Cut
detector inference p95 from 2.1s...").

**Rule 2 — prose citation + new-entity check (`_verify_prose_unit` / `find_candidate_entities` /
`build_entity_lexicon`).** Every `sources[]` entry must resolve: known `file` (`"cv.md"` or
`"article-digest.md"`), `quote` found verbatim (normalized) in that file. Empty/missing
`sources[]` is treated as an automatic `missing_span` failure — nothing to verify against counts
as unanchored. Then the new-entity check: candidate entities are the union of (a) capitalized
multi-char tokens NOT at the start of a sentence (sentence-initial capitalization is just English
grammar, not a signal) and (b) any lexicon term — built from the CV's own `## Skills` section
bullets, split on commas then also on whitespace so multi-word phrases contribute their individual
words too — found anywhere in the text regardless of position. Every candidate entity must appear
in the union of the unit's *own* cited quotes (not the whole cv.md) — this is what stops citing
one bullet's source while writing about an unrelated tool from elsewhere in the CV. Missing entity
→ `new_entity`; missing/unresolved source → `missing_span`.

Documented gap: a genuinely novel entity that both opens a sentence AND isn't in the CV's skills
lexicon can slip past the capitalization heuristic (heuristic coverage, not exhaustive NLP —
matches the brief's "100% recall isn't the bar").

**Rule 3 — structural facts (`_verify_structural_unit`).** `header` kind: `fields.{org, title,
location, period}`; `edu` kind: `fields.{school, degree, period}`. Each non-empty field must
verbatim-substring-match (ASCII/whitespace-normalized) somewhere in cv.md text — no citation
needed. An empty/omitted field (e.g. no location) is skipped, not failed. **Judgment call**: the
`dropped[].reason` enum only has three values (`number_not_confirmed`, `missing_span`,
`new_entity`) — there's no dedicated "structural mismatch" reason in §2.1's schema. Structural
failures are reported as `missing_span` (the closest existing bucket — "this fact has no matching
span in the pinned doc"), documented both in the module docstring and inline at
`_verify_structural_unit`.

The identity header (name/email/etc.) is never a claims.json unit at all — it's assembled directly
from `profile.yml::identity` by `base_identity()` in `latex_resume.py`, never LLM-generated, so it
carries no fabrication risk. Documented in the module docstring so a future reader doesn't wonder
why identity isn't verified here.

## Voice exemption — the trickiest judgment call

Brief text: *"a kind:'voice' CL sentence skips rule 2's span requirement ONLY if it has zero
numeric tokens (rule 1 still applies) and zero new entities... a voice sentence that trips either
becomes a normal factual unit... if it now fails, drop it."*

I read "zero numeric tokens" literally — **any** numeric token trips the exemption, not just an
*unconfirmed* one. So the check is: `tokens = extract_numeric_tokens(text)` and `entities =
find_candidate_entities(text, lexicon)` (entity detection reused **without** the span-membership
check — a clean voice sentence isn't expected to cite anything). If both are empty, exempt: status
`"verified"`, `kind` stays `"voice"`, `numbers: []`, no `sources[]` requirement. If either is
non-empty, the unit is reclassified and run through the full `_verify_prose_unit` path (rule 1 +
rule 2, sources now required). This means a voice sentence containing a *confirmed* number still
gets reclassified (and can still survive, just no longer tagged `"voice"` — its `kind` flips to
`"cl_sentence"` in the output). Covered by
`test_voice_unit_with_confirmed_number_is_reclassified_and_can_still_pass`.

## Render rule (`drop_unverified`)

Pure function, separate from `verify_claims`. Groups surviving unit ids by the `r.exp{i}.b{j}` /
`r.exp{i}.header` id convention; any experience header whose experience index has zero surviving
bullets is excluded from the returned survivor set — "an empty experience entry doesn't render."
It does not re-derive verification or mutate `claims`; it only applies this one cascade on top of
whatever `verify_claims` already decided. All other unit ids (skills, summary, education,
cover-letter sentences) pass through unchanged.

## Test coverage (`tests/test_claims.py`, 28 tests, all green)

Fixtures: a small self-contained "Alex Quinn" cv.md/article-digest.md pair built directly in the
test file — **not** `profile.example/`, whose `article-digest.md` uses the legacy single-user
headings ("Metrics we are confident about" / "Metrics we DO NOT have") that predate the real
hosted format. Verified the real format against `web/lib/onboarding/moduleWriters/metrics.ts`
(`applyMetricsToDoc`) and `web/lib/dossier/derive.ts` (`extractMarkdownSection`,
`parseMarkdownList`) before writing the parser — `## Confirmed metrics` / `## Never use` as
`- <text> (from <source>)` bullets, section body read from the heading line to the next `## `
heading or EOF.

Covers every case the brief lists: numeric-token extraction table (percentages/dollar/multiplier/
duration/bare-count/range, parametrized) plus a dedicated range test; number confirmed via cv.md
span vs. via `## Confirmed metrics` (both bases asserted in output); number in `## Never use` fails
despite a valid span; anchored-prose pass; unanchored-prose drop (no sources / quote not found /
unknown file, parametrized); new-entity smuggling with a resolving source; voice exemption pass;
voice unit smuggling a company name → reclassified + dropped (`new_entity`); voice unit with a
confirmed number → reclassified + survives (`kind` flips to `cl_sentence`); structural
header/education exact-match pass and fail; experience entry with all bullets dropped → header
excluded by `drop_unverified`; a non-experience unit id left untouched by the cascade; entity
lexicon built from the CV's own Skills section (asserts both single-word and multi-word-phrase
lexicon entries, and that an unrelated term like "snowflake" is absent); output shape (`version`,
`doc_sha256`, empty-input handling).

## Test commands run and output

Note: `pytest` isn't on PATH / installed in the ambient interpreter in this environment, and `uv
run` failed to resolve the full project dependency tree (pre-existing `requires-python = ">=3.9"`
vs. `claude-agent-sdk>=0.1.0` needing `>=3.10` — unrelated to this task, not touched). Built an
isolated `uv venv --python 3.12` in the scratchpad dir and `uv pip install -e ".[dev]"` into it to
run the suite.

```
$ python -m pytest tests/test_claims.py -v
...
28 passed in 0.02s
```

```
$ python -m pytest
...
687 passed, 1 skipped, 26 deselected in 27.90s
```

No regressions — this task only added two new files, so a full-suite break would have indicated a
naming collision or import-time side effect, neither of which occurred.

## Fix — Skills heading lookup broadened

A task reviewer flagged that `build_entity_lexicon`'s Skills-section lookup
(`_extract_skills_section`, via `_extract_markdown_section(cv_text, "Skills")`) required an exact,
case-sensitive `"## Skills"` line match — but both shipped reference personas
(`profile.example/cv.md:28`, `onboarding/examples/profile/cv.md:23`) head their skills section
`## Technical Skills`, not `## Skills`. Against any real profile following the shipped convention,
the lookup silently returned `""`, `build_entity_lexicon` returned an empty set, and rule 2's
new-entity check ran with zero known entities — degrading it to "flag every capitalized noun,"
undetected because `tests/test_claims.py`'s only fixture used `## Skills`.

Fix, scoped to `_extract_skills_section` only (`jobify/tailor/claims.py`) — `_extract_markdown_section`
itself is untouched, since it's also relied on for the article-digest.md `## Confirmed metrics` /
`## Never use` parsing, which is verified-correct against the real writer:

- Try the known literal headings first, in order (`"Technical Skills"`, then `"Skills"`), each via
  the existing exact-match `_extract_markdown_section` helper.
- If neither hits, fall back to a case-insensitive scan for any `## ...` heading line whose text
  contains `"skill"`, so further unanticipated spellings (e.g. `## skills`, `## Core Skills`) still
  resolve instead of silently degrading to an empty lexicon again.

Added `test_entity_lexicon_is_built_from_cv_technical_skills_section` to `tests/test_claims.py`:
builds a `## Technical Skills`-headed CV fixture, asserts `build_entity_lexicon` picks up its
terms (`snowflake`, `dbt`, `airflow`), and runs a full `verify_claims` end-to-end check proving a
claim citing "Snowflake" against a resolving `cv.md` quote survives (is NOT dropped as
`REASON_NEW_ENTITY`) — the exact regression the missing-heading bug would have caused.

Manually re-verified `build_entity_lexicon` against both real reference CVs post-fix
(`profile.example/cv.md`, `onboarding/examples/profile/cv.md`) — both now yield non-empty lexicons
(47 and 55 entities respectively), versus empty sets pre-fix.

```
$ .venv/bin/pytest tests/test_claims.py -v
...
29 passed in 0.03s
```

```
$ .venv/bin/pytest
...
688 passed, 1 skipped, 26 deselected in 25.34s
```

Diff stays inside `jobify/tailor/claims.py` + `tests/test_claims.py` + this report file.
