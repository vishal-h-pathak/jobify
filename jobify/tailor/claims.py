"""jobify/tailor/claims.py — deterministic claims verifier (V3B S1).

Implements the "traceable-claims model" from ``planning/V3B_DESIGN.md`` §2.
The LLM proposes claim units (resume bullets/skills/headers/education
entries/summary line, plus cover-letter sentence units from a separate
attribution call) each citing the profile doc span it's drawn from. This
module is the *authority* — it re-checks every proposal against the pinned
profile doc snapshot with three mechanical, unit-testable rules and only
ever accepts (``status: "verified"``) or drops a unit. It never invents,
never asks an LLM anything, and never trusts the model's self-report.

Nothing here reaches into Supabase, the filesystem, or the profile loader —
callers (the hosted tailor worker, Task 5) pass in already-materialized
``cv_text`` / ``article_digest_text`` strings plus the ``doc_sha256`` that
pins the snapshot they were read from. That keeps this module a pure
function of its inputs, which is what makes exhaustive table-driven testing
possible without any network or LLM call.

Import style note: this file is a normally-packaged module
(``jobify.tailor.claims``), NOT part of the bare-import subtree under
``jobify/tailor/tailor/*.py`` (which relies on ``jobify/tailor/pipeline.py``'s
sys.path bootstrap so its files can do ``from tailor.X import Y``). It
imports ``normalize_for_ats`` the normal fully-qualified way and adds no
sys.path bootstrap of its own.

── Unit shape (proposed input) ─────────────────────────────────────────────

Every proposed unit is a plain dict:

    {
      "id": "r.exp0.b2",              # stable: surface.section.index
      "surface": "resume" | "cover_letter",
      "kind": "bullet" | "skill" | "header" | "edu" | "summary"
              | "cl_sentence" | "voice",
      "text": "...",                  # required for bullet/skill/summary/
                                       # cl_sentence/voice; unused for
                                       # header/edu (they use "fields")
      "sources": [{"file": "cv.md", "quote": "..."}],   # rule 2 (optional
                                                          # for header/edu)
      "fields": {...},                # header: org/title/location/period;
                                       # edu: school/degree/period — rule 3
    }

``kind`` distinguishes "cl_sentence" (a factual cover-letter sentence that
must cite a span like a resume bullet) from "voice" (a connective,
non-factual cover-letter sentence proposed by the attribution call — see
the voice-exemption section below). Both are ``surface: "cover_letter"``.

Header/edu units carry structural facts under ``fields`` rather than
free-text ``text`` + ``sources`` — see rule 3.

── Output shape (``claims.json``, §2.1) ────────────────────────────────────

    {
      "version": 1,
      "doc_sha256": "...",
      "units": [{..., "numbers": [...], "status": "verified"}],
      "dropped": [{"id": ..., "text": ..., "reason": "..."}],
    }

This function only ever assigns ``status: "verified"`` to a surviving unit
(never ``"voice"`` — that status value exists in the schema for a later
stage; see ``kind`` above for how voice-ness is preserved) or removes it
into ``dropped``. ``status: "user_edited"`` is assigned later, by the
inline-edit flow (§2.5) — never by this verifier.

``dropped[].reason`` is one of three values (``number_not_confirmed``,
``missing_span``, ``new_entity``) — there is no dedicated "structural
mismatch" reason in the schema. Rule 3 (structural facts) failures are
reported as ``missing_span``: the closest existing bucket, since a
structural-fact mismatch is, in essence, "this fact has no matching span in
the pinned cv.md". See ``_verify_structural_unit`` for where that mapping
happens.

The identity header (name/email/location/links) is NOT a claims.json unit
at all: it's assembled directly from ``profile.yml::identity`` by
``jobify.tailor.tailor.latex_resume::base_identity`` — never LLM-generated,
so it carries no fabrication risk and never needs verification here.
"""

from __future__ import annotations

import re
import string
from typing import Iterable, Mapping, Sequence

from jobify.tailor.tailor.normalize import normalize_for_ats

CLAIMS_SCHEMA_VERSION = 1

# ── Reasons / kinds (schema constants) ──────────────────────────────────────

REASON_NUMBER_NOT_CONFIRMED = "number_not_confirmed"
REASON_MISSING_SPAN = "missing_span"
REASON_NEW_ENTITY = "new_entity"

# Kinds verified structurally (rule 3) — no citation, exact string match.
_STRUCTURAL_KINDS = {"header", "edu"}

# Required (non-empty-checked) fields per structural kind.
_STRUCTURAL_FIELDS = {
    "header": ("org", "title", "location", "period"),
    "edu": ("school", "degree", "period"),
}

# Kinds that may be tagged "voice" (cover-letter connective sentences).
_VOICEABLE_KIND = "voice"


# ── Rule 1: numeric-token extraction ────────────────────────────────────────
#
# Coverage (documented, not exhaustive — 100% recall isn't the bar):
#   - percentages:      40%, 12.5%
#   - dollar amounts:   $5M, $200k, $2,000, $2.5M
#   - multipliers:      3x, 10x, 3X
#   - durations/latency: 2.1s, 380ms, 4s, 2hr, 45min  (number glued directly
#     to a unit abbreviation, no space — matches how these are actually
#     written in resume prose)
#   - ranges:           "2.1s to 380ms" needs no special case — the regex
#     just finds both tokens independently via non-overlapping finditer()
#   - plain counts:     "14 teams" extracts the bare number "14" — the
#     token is the digits alone; adjacent nouns ("teams") are not part of
#     the token, matching how "%"/"$"/"x"/duration tokens are each a single
#     contiguous span with no internal space.
#
# What it deliberately does NOT catch: spelled-out numbers ("fourteen"),
# ordinals ("3rd"), fractions ("half"), or dates/years embedded in prose
# (those are handled structurally via experience[].period / education[].
# period, not this regex — see the header/edu carve-out in verify_unit).
#
# The bare-count alternative is guarded with a negative lookbehind so it
# doesn't fire on digits glued to a preceding letter OR digit — e.g. "p95"
# (a percentile, like "p95 latency") or "RT-DETRv2" (a model name) are
# identifiers, not citable numeric claims, even though they contain
# digits. Blocking on a preceding digit too (not just a letter) matters
# because otherwise a blocked match at the run's first digit ("9" in
# "p95") would just let the regex retry one character later and match the
# tail of the same run ("5") as if it were its own bare count. A real
# plain count is always preceded by whitespace/punctuation or
# string-start ("14 teams", "(14)").
_NUMERIC_TOKEN_RE = re.compile(
    r"""
    \$\d[\d,]*(?:\.\d+)?[kKmMbB]?          # dollar amounts: $5M, $200k, $2,000
    | \d+(?:\.\d+)?\s?%                    # percentages: 40%, 12.5 %
    | \d+(?:\.\d+)?[xX]                    # multipliers: 3x, 10X
    | \d+(?:\.\d+)?(?:ms|hrs|hr|mins|min|secs|sec|s|h|d|wk|yr|yrs)\b  # durations
    | (?<![A-Za-z0-9])\d+(?:\.\d+)?        # bare counts: 14, 3.5 (not "p95")
    """,
    re.VERBOSE,
)


def extract_numeric_tokens(text: str) -> list[str]:
    """Extract numeric tokens from ``text`` per the coverage documented above.

    Order matters: the regex alternation is tried most-specific-first ($,
    %, multiplier, duration) so e.g. "380ms" is captured whole rather than
    as a bare "380" followed by a dangling "ms". The trailing bare-number
    alternative only fires when nothing more specific matched at that
    position.
    """
    if not text:
        return []
    return [m.group(0).strip() for m in _NUMERIC_TOKEN_RE.finditer(text)]


def _normalize_for_compare(text: str) -> str:
    """ASCII + whitespace normalize for verbatim substring comparison.

    Applies the repo's shared ATS normalization (dashes/quotes/ligatures →
    ASCII) and then collapses ALL whitespace (including newlines, since a
    cited cv.md span can cross line breaks) to single spaces.
    """
    if not text:
        return ""
    out = normalize_for_ats(text)
    return re.sub(r"\s+", " ", out).strip()


def _token_in_text(token: str, haystack_normalized: str) -> bool:
    """Whole-token, boundary-safe substring check.

    Plain substring containment would let a bare count like "14" match
    inside an unrelated "140" or "$14.50". Word-boundary anchoring on both
    sides (using a not-preceded/not-followed-by-word-char lookaround rather
    than ``\\b``, since tokens like "$5M" and "40%" start/end with
    non-word characters where ``\\b`` doesn't apply cleanly) keeps the
    check precise without losing the tokens that DO have unit suffixes
    glued on.
    """
    if not token:
        return False
    pattern = re.compile(r"(?<!\w)" + re.escape(token) + r"(?!\w)")
    return pattern.search(haystack_normalized) is not None


# ── article-digest.md section parsing ───────────────────────────────────────
#
# The REAL hosted format (web/lib/onboarding/moduleWriters/metrics.ts,
# cross-referenced against web/lib/dossier/derive.ts's
# extractMarkdownSection): "## Confirmed metrics" / "## Never use" as
# "- <text> (from <source>)" bullet lines. This is NOT the legacy
# profile.example/article-digest.md persona doc's headings ("Metrics we are
# confident about" etc.) — that file predates the hosted V3a metrics module.
#
# extractMarkdownSection reads from the heading line to the next "## "
# heading (or EOF). We replicate that walk here; unlike the TS helper we
# match the heading text case-sensitively ("## Confirmed metrics" / "##
# Never use" exactly) per this task's brief.

_HEADING_RE = re.compile(r"^##\s+")


def _extract_markdown_section(markdown: str, heading: str) -> str:
    """Return the body of a ``## <heading>`` section (heading exclusive).

    Mirrors ``web/lib/dossier/derive.ts::extractMarkdownSection``: find the
    line that is exactly ``## <heading>`` (after stripping), then return
    every line up to (not including) the next ``## `` heading or EOF.
    """
    lines = markdown.split("\n")
    target = f"## {heading}"
    start_idx = None
    for i, line in enumerate(lines):
        if line.strip() == target:
            start_idx = i
            break
    if start_idx is None:
        return ""
    rest = lines[start_idx + 1 :]
    end_idx = None
    for i, line in enumerate(rest):
        if _HEADING_RE.match(line):
            end_idx = i
            break
    body_lines = rest if end_idx is None else rest[:end_idx]
    return "\n".join(body_lines)


def parse_metrics_sections(article_digest_text: str) -> tuple[str, str]:
    """Return ``(confirmed_metrics_text, never_use_text)`` from article-digest.md.

    Each returned string is the raw, normalized body text of its section
    (all bullet lines joined) — callers verbatim-search numeric tokens
    against it via ``_token_in_text`` rather than parsing individual
    bullets, since a token only needs to appear somewhere in the section,
    not match a whole bullet.
    """
    confirmed = _extract_markdown_section(article_digest_text or "", "Confirmed metrics")
    never_use = _extract_markdown_section(article_digest_text or "", "Never use")
    return _normalize_for_compare(confirmed), _normalize_for_compare(never_use)


# ── Rule 2: entity lexicon + candidate-entity detection ─────────────────────


def _extract_skills_section(cv_text: str) -> str:
    return _extract_markdown_section(cv_text or "", "Skills")


def build_entity_lexicon(cv_text: str) -> set[str]:
    """Build a known-tool/entity lexicon from the CV's own Skills section.

    Generalizes to any persona's cv.md: no hardcoded tool list. Each
    ``- ...`` bullet line under "## Skills" is split on commas (skills are
    typically comma-separated within a bullet), and each resulting phrase
    is ALSO split on whitespace so multi-word phrases ("AWS Lambda")
    contribute their individual words ("AWS", "Lambda") too — this catches
    a claim that mentions just "Lambda" even though the CV only ever
    lists the fuller phrase.
    """
    section = _extract_skills_section(cv_text)
    lexicon: set[str] = set()
    for line in section.split("\n"):
        stripped = line.strip()
        if not stripped.startswith("- "):
            continue
        body = stripped[2:].strip()
        for phrase in body.split(","):
            phrase = phrase.strip().strip("*").strip()
            if not phrase:
                continue
            lexicon.add(phrase.lower())
            for word in phrase.split():
                word = word.strip(string.punctuation)
                if len(word) >= 2:
                    lexicon.add(word.lower())
    return lexicon


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.#/'-]*")

# Common sentence-initial words that are capitalized only by English
# convention, not because they name an entity. Small and deliberately
# conservative — false negatives here (missing a real new entity) are
# preferable to false positives that make every sentence fail.
_COMMON_LEADING_WORDS = {
    "i", "a", "the", "this", "that", "these", "those", "our", "my", "we",
    "he", "she", "it", "they", "led", "built", "shipped", "cut", "drove",
    "owned", "designed", "delivered", "reduced", "improved", "grew",
}


def find_candidate_entities(text: str, lexicon: Iterable[str]) -> set[str]:
    """Find candidate proper-noun / known-tool tokens in ``text``.

    Union of two passes:
      1. Capitalized multi-char tokens NOT at the start of a sentence
         (sentence-initial capitalization is just English grammar, not a
         signal — see ``_COMMON_LEADING_WORDS``/index-0 skip below).
      2. Any lexicon term (built from the CV's Skills section — see
         ``build_entity_lexicon``) that occurs anywhere in the text,
         REGARDLESS of position — this is what catches a lexicon term
         that happens to open the sentence (e.g. "AWS Lambda cut ...").

    Known gap (documented, not fixed): a genuinely novel entity that both
    opens a sentence AND isn't in the CV's skills lexicon (e.g. a brand
    new employer name as the very first word) can slip past pass 1. This
    is a reasonable-coverage heuristic, not exhaustive NLP.
    """
    if not text:
        return set()
    lexicon_lower = {t.lower() for t in lexicon if t}
    found: set[str] = set()

    for sentence in _SENTENCE_SPLIT_RE.split(text):
        words = sentence.split()
        for i, raw in enumerate(words):
            token = raw.strip(string.punctuation)
            if len(token) < 2:
                continue
            if i == 0:
                continue  # sentence-initial capitalization isn't a signal
            if not token[0].isupper():
                continue
            if token.lower() in _COMMON_LEADING_WORDS:
                continue
            found.add(token)

    for word_match in _WORD_RE.finditer(text):
        word = word_match.group(0)
        if word.lower() in lexicon_lower:
            found.add(word)

    # Multi-word phrase pass: scan the lexicon for any multi-word phrase
    # (contains a space) that appears verbatim (case-insensitive) in text.
    text_lower = text.lower()
    for phrase in lexicon_lower:
        if " " in phrase and phrase in text_lower:
            found.add(phrase)

    return found


def _entities_covered_by_quotes(entities: set[str], quotes_text_normalized: str) -> list[str]:
    """Return the subset of ``entities`` NOT found in the cited-quotes text."""
    missing = []
    for entity in entities:
        normalized_entity = _normalize_for_compare(entity)
        if not _token_in_text_ci(normalized_entity, quotes_text_normalized):
            missing.append(entity)
    return missing


def _token_in_text_ci(token: str, haystack_normalized: str) -> bool:
    if not token:
        return False
    pattern = re.compile(r"(?<!\w)" + re.escape(token) + r"(?!\w)", re.IGNORECASE)
    return pattern.search(haystack_normalized) is not None


# ── Rule 2: source resolution ────────────────────────────────────────────────


def _resolve_sources(
    sources: Sequence[Mapping[str, str]] | None, docs: Mapping[str, str]
) -> tuple[bool, str]:
    """Resolve every ``{file, quote}`` source against the pinned docs.

    Returns ``(ok, concatenated_normalized_quotes_text)``. ``ok`` is False
    if ``sources`` is empty/missing (nothing to verify against counts as a
    missing span) or if any entry's file is unknown or its quote isn't
    found verbatim (normalized) in that file's text.
    """
    if not sources:
        return False, ""
    quotes: list[str] = []
    for source in sources:
        file_name = source.get("file")
        quote = source.get("quote") or ""
        doc_text = docs.get(file_name) if file_name else None
        if doc_text is None:
            return False, ""
        haystack = _normalize_for_compare(doc_text)
        needle = _normalize_for_compare(quote)
        if not needle or needle not in haystack:
            return False, ""
        quotes.append(needle)
    return True, " ".join(quotes)


# ── Per-unit verification ───────────────────────────────────────────────────


def _verify_numbers(text: str, confirmed_text: str, never_use_text: str, quotes_text: str) -> tuple[bool, list[dict]]:
    """Rule 1. Returns ``(ok, numbers)`` where ``numbers`` is the §2.1
    per-unit ``numbers[]`` list (only populated when ``ok`` is True — a
    failing unit is dropped wholesale, so its numbers list is moot)."""
    tokens = extract_numeric_tokens(text)
    numbers: list[dict] = []
    for token in tokens:
        if _token_in_text(token, never_use_text):
            return False, []
        in_confirmed = _token_in_text(token, confirmed_text)
        in_span = _token_in_text(token, quotes_text)
        if not (in_confirmed or in_span):
            return False, []
        basis = "confirmed_metric" if in_confirmed else "cv_span"
        numbers.append({"token": token, "basis": basis})
    return True, numbers


def _verify_prose_unit(
    unit: Mapping,
    docs: Mapping[str, str],
    lexicon: set[str],
    confirmed_text: str,
    never_use_text: str,
) -> tuple[bool, str | None, list[dict]]:
    """Rule 1 + rule 2 for bullet/skill/summary/cl_sentence (non-exempt
    voice) kinds. Returns ``(ok, reason_if_failed, numbers)``."""
    text = unit.get("text") or ""
    sources_ok, quotes_text = _resolve_sources(unit.get("sources"), docs)

    numbers_ok, numbers = _verify_numbers(text, confirmed_text, never_use_text, quotes_text)
    if not numbers_ok:
        return False, REASON_NUMBER_NOT_CONFIRMED, []

    if not sources_ok:
        return False, REASON_MISSING_SPAN, []

    entities = find_candidate_entities(text, lexicon)
    missing_entities = _entities_covered_by_quotes(entities, quotes_text)
    if missing_entities:
        return False, REASON_NEW_ENTITY, []

    return True, None, numbers


def _verify_voice_unit(
    unit: Mapping,
    docs: Mapping[str, str],
    lexicon: set[str],
    confirmed_text: str,
    never_use_text: str,
) -> tuple[bool, str | None, list[dict], bool]:
    """Voice exemption (§2.3 + brief). A ``kind: "voice"`` cover-letter
    sentence skips rule 2's span requirement ONLY if it has ZERO numeric
    tokens at all (not "numbers that happen to be confirmed" — the
    exemption is for sentences making no checkable claim whatsoever) AND
    zero candidate entities (reusing rule 2's detector, but WITHOUT
    checking span-membership, since a clean voice sentence isn't expected
    to cite anything). Tripping either check reclassifies the unit as
    normal factual prose and re-verifies it via the full rule 1 + rule 2
    path (sources now required, numbers checked against confirmed_metrics/
    cv-span same as any other unit).

    Returns ``(ok, reason, numbers, reclassified)`` — ``reclassified`` is
    True whenever the exemption didn't apply, so the caller can flip the
    emitted unit's ``kind`` from "voice" to "cl_sentence" (a unit that
    needed sourcing to survive shouldn't keep advertising itself as
    exempt-from-sourcing in the output)."""
    text = unit.get("text") or ""
    tokens = extract_numeric_tokens(text)
    entities = find_candidate_entities(text, lexicon)

    if not tokens and not entities:
        return True, None, [], False

    ok, reason, numbers = _verify_prose_unit(unit, docs, lexicon, confirmed_text, never_use_text)
    return ok, reason, numbers, True


def _verify_structural_unit(unit: Mapping, cv_text_normalized: str) -> tuple[bool, str | None]:
    """Rule 3. ``header``/``edu`` kinds: every non-empty required field
    must string-match (verbatim substring, ASCII/whitespace-normalized)
    somewhere in the pinned cv.md text. No ``sources[]`` needed.

    Failures map to ``REASON_MISSING_SPAN`` — the schema has no dedicated
    "structural mismatch" reason (see module docstring)."""
    kind = unit.get("kind")
    fields = unit.get("fields") or {}
    for key in _STRUCTURAL_FIELDS.get(kind, ()):
        value = str(fields.get(key) or "").strip()
        if not value:
            continue  # nothing to check for an omitted optional field
        if _normalize_for_compare(value) not in cv_text_normalized:
            return False, REASON_MISSING_SPAN
    return True, None


# ── Public entry point ──────────────────────────────────────────────────────


def verify_claims(
    proposed_units: Sequence[Mapping],
    *,
    cv_text: str,
    article_digest_text: str,
    doc_sha256: str,
) -> dict:
    """Verify a batch of LLM-proposed claim units against the pinned profile
    doc snapshot (``cv_text`` + ``article_digest_text``) and return the
    ``claims.json`` dict shape (§2.1).

    Zero LLM calls, zero I/O — pure function of its arguments. Callers
    (the hosted tailor worker) are responsible for reading ``cv_text`` /
    ``article_digest_text`` from the materialized profile dir and computing
    ``doc_sha256`` before calling this.

    Every surviving unit is assigned ``status: "verified"`` (this function
    never assigns ``"user_edited"`` or ``"voice"`` as a *status* — see the
    module docstring). Units that fail land in ``dropped[]`` with a
    ``reason``.
    """
    docs = {"cv.md": cv_text or "", "article-digest.md": article_digest_text or ""}
    confirmed_text, never_use_text = parse_metrics_sections(article_digest_text or "")
    lexicon = build_entity_lexicon(cv_text or "")
    cv_text_normalized = _normalize_for_compare(cv_text or "")

    units: list[dict] = []
    dropped: list[dict] = []

    for unit in proposed_units:
        kind = unit.get("kind")
        unit_id = unit.get("id")

        if kind in _STRUCTURAL_KINDS:
            ok, reason = _verify_structural_unit(unit, cv_text_normalized)
            if ok:
                units.append({**unit, "status": "verified"})
            else:
                dropped.append(
                    {"id": unit_id, "text": _structural_text(unit), "reason": reason}
                )
            continue

        reclassified = False
        if kind == _VOICEABLE_KIND:
            ok, reason, numbers, reclassified = _verify_voice_unit(
                unit, docs, lexicon, confirmed_text, never_use_text
            )
        else:
            ok, reason, numbers = _verify_prose_unit(
                unit, docs, lexicon, confirmed_text, never_use_text
            )

        if ok:
            emitted = {**unit, "numbers": numbers, "status": "verified"}
            if reclassified:
                # Tripped the voice exemption and had to earn its keep via
                # the full factual path — stop advertising it as "voice"
                # (exempt from sourcing) in the output.
                emitted["kind"] = "cl_sentence"
            units.append(emitted)
        else:
            dropped.append({"id": unit_id, "text": unit.get("text") or "", "reason": reason})

    return {
        "version": CLAIMS_SCHEMA_VERSION,
        "doc_sha256": doc_sha256,
        "units": units,
        "dropped": dropped,
    }


def _structural_text(unit: Mapping) -> str:
    """Human-readable text for a dropped structural unit (no ``text`` field
    on header/edu units — synthesize one from ``fields`` for the drop log)."""
    fields = unit.get("fields") or {}
    parts = [str(v) for v in fields.values() if v]
    return " / ".join(parts)


# ── Render rule (§2.4) ───────────────────────────────────────────────────────
#
# ID convention this repo uses for resume claim units (stable:
# surface.section.index, per §2.1's "r.exp0.b2" example):
#   - experience header:  r.exp{i}.header
#   - experience bullet:  r.exp{i}.b{j}
#   - education entry:    r.edu{i}
#   - skill category:     r.skill{i}
#   - summary line:       r.summary
#   - cover-letter sentence: cl.s{i}   (kind "cl_sentence" or "voice")
#
# Task 5 (the worker) is expected to mint ids following this convention
# when it assembles the proposed units for verify_claims().

_EXP_BULLET_RE = re.compile(r"^r\.exp(\d+)\.b\d+$")
_EXP_HEADER_RE = re.compile(r"^r\.exp(\d+)\.header$")


def drop_unverified(claims: Mapping) -> set[str]:
    """Given a verified ``claims.json`` dict (the output of
    ``verify_claims``), return the set of unit ids that should actually
    render.

    This is the render rule from §2.4 as a separable pure function: the
    renderer consumes only verified/user_edited/voice units, AND an
    experience entry whose every bullet was dropped (or that simply has
    zero bullets among the surviving units) is cascaded out too — an
    empty experience entry is noise, not content. Every other surviving
    unit id passes through unchanged.

    This function does not mutate ``claims`` or re-derive verification —
    it only applies the bullet-emptiness cascade on top of whatever
    ``verify_claims`` already decided survives.
    """
    kept_ids = {u["id"] for u in claims.get("units", []) if u.get("id")}

    bullets_by_exp: dict[str, list[str]] = {}
    headers_by_exp: dict[str, str] = {}
    for uid in kept_ids:
        bullet_match = _EXP_BULLET_RE.match(uid)
        if bullet_match:
            bullets_by_exp.setdefault(bullet_match.group(1), []).append(uid)
            continue
        header_match = _EXP_HEADER_RE.match(uid)
        if header_match:
            headers_by_exp[header_match.group(1)] = uid

    survivors = set(kept_ids)
    for exp_idx, header_id in headers_by_exp.items():
        if not bullets_by_exp.get(exp_idx):
            survivors.discard(header_id)

    return survivors
