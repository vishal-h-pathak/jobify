"""tests/test_claims.py — the V3B deterministic claims verifier.

Covers `jobify.tailor.claims` (§2.3 of `planning/V3B_DESIGN.md`): pure
Python, zero LLM calls, zero I/O. Fixtures are a small, self-contained
"Alex Quinn"-persona cv.md / article-digest.md pair authored directly
below — NOT `profile.example/`, whose `article-digest.md` uses different,
legacy headings ("Metrics we are confident about" / "Metrics we DO NOT
have") that predate the hosted V3a metrics module. The real hosted format
(`web/lib/onboarding/moduleWriters/metrics.ts`, cross-checked against
`web/lib/dossier/derive.ts` and its test at `derive.test.ts:99`) is
`## Confirmed metrics` / `## Never use` as `- <text> (from <source>)`
bullet lines — that's what these fixtures use, and what
`jobify/tailor/claims.py` parses.
"""

from __future__ import annotations

import pytest

from jobify.tailor import claims

DOC_SHA = "deadbeefcafefeed" * 4  # arbitrary pinned-snapshot hash for tests

CV_TEXT = """# CV

## Skills

- Python, Kubernetes, Terraform, AWS Lambda
- PostgreSQL, Kafka, distributed systems

## Experience

### Northwind Robotics — Senior Platform Engineer
Atlanta, GA | 2021—Present

- Rewrote the detector inference runtime in Rust, cutting p95 latency from 2.1s to 380ms on Jetson Orin.
- Led the migration of the core service to Kubernetes across 14 teams.
- Drove adoption of the new observability stack across all engineering teams.
- Managed a $5M cloud infrastructure budget for the platform org.

### Brightwave Analytics — Platform Engineer
Denver, CO | 2018—2021

- Built the ingestion pipeline that handled 3x more throughput after the rewrite.

## Education

### Georgia Tech — B.S. Computer Science
2014—2018
"""

DIGEST_TEXT = """# Article digest

## Confirmed metrics

- Grew platform adoption 40% after the observability rollout (from cv.md)

## Never use

- Saved $5M annually (unverifiable)
- 10x productivity gains (unverifiable)
"""


def _verify(units: list[dict]) -> dict:
    return claims.verify_claims(
        units,
        cv_text=CV_TEXT,
        article_digest_text=DIGEST_TEXT,
        doc_sha256=DOC_SHA,
    )


def _survivor_ids(result: dict) -> set[str]:
    return {u["id"] for u in result["units"]}


def _dropped_reasons(result: dict) -> dict[str, str]:
    return {d["id"]: d["reason"] for d in result["dropped"]}


def _unit_by_id(result: dict, unit_id: str) -> dict:
    for u in result["units"]:
        if u["id"] == unit_id:
            return u
    raise AssertionError(f"{unit_id} did not survive verification")


# ── Unit factories ───────────────────────────────────────────────────────


def _bullet(id_: str, text: str, sources: list[dict] | None = None, kind: str = "bullet") -> dict:
    return {"id": id_, "surface": "resume", "kind": kind, "text": text, "sources": sources or []}


def _header(id_: str, org: str, title: str, location: str, period: str) -> dict:
    return {
        "id": id_,
        "surface": "resume",
        "kind": "header",
        "fields": {"org": org, "title": title, "location": location, "period": period},
    }


def _edu(id_: str, school: str, degree: str, period: str) -> dict:
    return {
        "id": id_,
        "surface": "resume",
        "kind": "edu",
        "fields": {"school": school, "degree": degree, "period": period},
    }


def _voice(id_: str, text: str, sources: list[dict] | None = None) -> dict:
    return {"id": id_, "surface": "cover_letter", "kind": "voice", "text": text, "sources": sources or []}


# ── Rule 1 — numeric-token extraction (table-driven) ─────────────────────


@pytest.mark.parametrize(
    "text,expected_tokens",
    [
        ("Grew revenue 40% quarter over quarter", ["40%"]),
        ("Closed a $5M contract", ["$5M"]),
        ("Cut onboarding time to $200k under budget", ["$200k"]),
        ("Improved throughput 3x over the old system", ["3x"]),
        ("Rolled out to 14 teams company-wide", ["14"]),
        ("Cut latency from 2.1s to 380ms", ["2.1s", "380ms"]),
        ("No numbers in this sentence at all", []),
    ],
)
def test_extract_numeric_tokens_coverage(text: str, expected_tokens: list[str]) -> None:
    assert claims.extract_numeric_tokens(text) == expected_tokens


def test_extract_numeric_tokens_range_extracts_both_ends_independently() -> None:
    # Context item #4: a range like "2.1s to 380ms" must yield BOTH tokens
    # as independently-verifiable entries, not a single "2.1s to 380ms" blob.
    tokens = claims.extract_numeric_tokens("Cut p95 from 2.1s to 380ms on Jetson Orin")
    assert tokens == ["2.1s", "380ms"]


# ── Rule 1 — number confirmation paths ────────────────────────────────────


def test_number_confirmed_via_cv_span_passes() -> None:
    unit = _bullet(
        "r.exp0.b0",
        "Cut detector inference p95 from 2.1s to 380ms on Jetson Orin",
        sources=[
            {
                "file": "cv.md",
                "quote": "Rewrote the detector inference runtime in Rust, cutting p95 latency from 2.1s to 380ms on Jetson Orin.",
            }
        ],
    )
    result = _verify([unit])
    assert _survivor_ids(result) == {"r.exp0.b0"}
    survivor = _unit_by_id(result, "r.exp0.b0")
    assert survivor["status"] == "verified"
    bases = {n["token"]: n["basis"] for n in survivor["numbers"]}
    assert bases == {"2.1s": "cv_span", "380ms": "cv_span"}


def test_number_confirmed_via_article_digest_passes() -> None:
    # "40%" appears in article-digest.md's Confirmed metrics section but
    # NOT in the unit's own cited cv.md quote — path (a), not (b).
    unit = _bullet(
        "r.exp0.b2",
        "Grew platform adoption 40% after the observability rollout",
        sources=[
            {
                "file": "cv.md",
                "quote": "Drove adoption of the new observability stack across all engineering teams.",
            }
        ],
    )
    result = _verify([unit])
    assert _survivor_ids(result) == {"r.exp0.b2"}
    survivor = _unit_by_id(result, "r.exp0.b2")
    assert survivor["numbers"] == [{"token": "40%", "basis": "confirmed_metric"}]


def test_unconfirmed_number_drops_whole_unit() -> None:
    unit = _bullet(
        "r.exp0.bx",
        "Cut database costs by 25% after the migration",
        sources=[
            {
                "file": "cv.md",
                "quote": "Led the migration of the core service to Kubernetes across 14 teams.",
            }
        ],
    )
    result = _verify([unit])
    assert _survivor_ids(result) == set()
    assert _dropped_reasons(result) == {"r.exp0.bx": claims.REASON_NUMBER_NOT_CONFIRMED}


def test_number_in_never_use_fails_even_with_valid_cv_span() -> None:
    # $5M genuinely appears, verbatim, in a resolving cv.md quote — but
    # article-digest.md's "## Never use" also lists it, which must win
    # regardless of the valid span (design doc §2.3 rule 1).
    unit = _bullet(
        "r.exp0.b3",
        "Saved $5M for the platform org this year",
        sources=[
            {
                "file": "cv.md",
                "quote": "Managed a $5M cloud infrastructure budget for the platform org.",
            }
        ],
    )
    result = _verify([unit])
    assert _survivor_ids(result) == set()
    assert _dropped_reasons(result) == {"r.exp0.b3": claims.REASON_NUMBER_NOT_CONFIRMED}


# ── Rule 2 — anchored prose ────────────────────────────────────────────────


def test_anchored_prose_with_no_new_entities_passes() -> None:
    unit = _bullet(
        "r.exp0.b4",
        "Drove adoption of the observability stack across engineering",
        sources=[
            {
                "file": "cv.md",
                "quote": "Drove adoption of the new observability stack across all engineering teams.",
            }
        ],
    )
    result = _verify([unit])
    assert _survivor_ids(result) == {"r.exp0.b4"}


@pytest.mark.parametrize(
    "sources",
    [
        [],  # no sources at all
        [{"file": "cv.md", "quote": "This phrase does not appear anywhere in the cv."}],  # bad quote
        [{"file": "resume.md", "quote": "Drove adoption of the new observability stack."}],  # unknown file
    ],
    ids=["no-sources", "quote-not-found", "unknown-file"],
)
def test_unanchored_prose_drops_with_missing_span(sources: list[dict]) -> None:
    unit = _bullet("r.exp0.b5", "Drove adoption of the observability stack", sources=sources)
    result = _verify([unit])
    assert _survivor_ids(result) == set()
    assert _dropped_reasons(result) == {"r.exp0.b5": claims.REASON_MISSING_SPAN}


def test_new_entity_smuggling_drops_despite_resolving_source() -> None:
    # sources[] resolves fine (the quote IS found verbatim in cv.md) but the
    # unit's text names a tool ("Snowflake") that quote never mentions.
    unit = _bullet(
        "r.exp0.b6",
        "Migrated the platform to Snowflake for faster analytics",
        sources=[
            {
                "file": "cv.md",
                "quote": "Led the migration of the core service to Kubernetes across 14 teams.",
            }
        ],
    )
    result = _verify([unit])
    assert _survivor_ids(result) == set()
    assert _dropped_reasons(result) == {"r.exp0.b6": claims.REASON_NEW_ENTITY}


# ── Voice exemption ──────────────────────────────────────────────────────


def test_voice_unit_with_zero_numbers_zero_entities_is_exempt() -> None:
    unit = _voice("cl.s0", "I'd bring that same rigor and curiosity to your team.")
    result = _verify([unit])
    assert _survivor_ids(result) == {"cl.s0"}
    survivor = _unit_by_id(result, "cl.s0")
    assert survivor["kind"] == "voice"  # stays "voice" — exemption applied cleanly
    assert survivor["numbers"] == []


def test_voice_unit_smuggling_company_name_is_reclassified_and_dropped() -> None:
    # Mentions "Snowflake" — trips the entity check, forcing reclassification
    # to a normal factual unit (full rule 1 + rule 2). Its cited source
    # resolves but never mentions Snowflake, so it fails as new_entity.
    unit = _voice(
        "cl.s1",
        "I've long admired Snowflake's engineering culture and want to bring that rigor here.",
        sources=[
            {
                "file": "cv.md",
                "quote": "Drove adoption of the new observability stack across all engineering teams.",
            }
        ],
    )
    result = _verify([unit])
    assert _survivor_ids(result) == set()
    assert _dropped_reasons(result) == {"cl.s1": claims.REASON_NEW_ENTITY}


def test_voice_unit_with_confirmed_number_is_reclassified_and_can_still_pass() -> None:
    # A voice sentence that contains ANY numeric token trips the exemption
    # (rule 1 still applies) even though the number turns out to be
    # confirmed and the sentence has zero new entities — it survives, but
    # as a reclassified "cl_sentence", not "voice" (it needed sourcing).
    unit = _voice(
        "cl.s2",
        "We grew adoption 40% last quarter, which mattered a lot to the team.",
        sources=[
            {
                "file": "cv.md",
                "quote": "Drove adoption of the new observability stack across all engineering teams.",
            }
        ],
    )
    result = _verify([unit])
    assert _survivor_ids(result) == {"cl.s2"}
    survivor = _unit_by_id(result, "cl.s2")
    assert survivor["kind"] == "cl_sentence"  # reclassified out of "voice"
    assert survivor["numbers"] == [{"token": "40%", "basis": "confirmed_metric"}]


# ── Rule 3 — structural facts (no citation) ───────────────────────────────


def test_experience_header_exact_match_passes() -> None:
    unit = _header("r.exp0.header", "Northwind Robotics", "Senior Platform Engineer", "Atlanta, GA", "2021—Present")
    result = _verify([unit])
    assert _survivor_ids(result) == {"r.exp0.header"}


def test_experience_header_mismatch_fails() -> None:
    unit = _header("r.exp0.header", "Northwind Robotics", "Staff Platform Engineer", "Atlanta, GA", "2021—Present")
    result = _verify([unit])
    assert _survivor_ids(result) == set()
    assert _dropped_reasons(result) == {"r.exp0.header": claims.REASON_MISSING_SPAN}


def test_education_exact_match_passes() -> None:
    unit = _edu("r.edu0", "Georgia Tech", "B.S. Computer Science", "2014—2018")
    result = _verify([unit])
    assert _survivor_ids(result) == {"r.edu0"}


def test_education_mismatch_fails() -> None:
    unit = _edu("r.edu0", "Georgia Tech", "M.S. Computer Science", "2014—2018")
    result = _verify([unit])
    assert _survivor_ids(result) == set()
    assert _dropped_reasons(result) == {"r.edu0": claims.REASON_MISSING_SPAN}


# ── Render rule (§2.4): drop_unverified cascade ───────────────────────────


def test_experience_entry_with_all_bullets_dropped_is_flagged_for_removal() -> None:
    units = [
        _header("r.exp0.header", "Northwind Robotics", "Senior Platform Engineer", "Atlanta, GA", "2021—Present"),
        _bullet(
            "r.exp0.b0",
            "Cut detector inference p95 from 2.1s to 380ms on Jetson Orin",
            sources=[
                {
                    "file": "cv.md",
                    "quote": "Rewrote the detector inference runtime in Rust, cutting p95 latency from 2.1s to 380ms on Jetson Orin.",
                }
            ],
        ),
        _header("r.exp1.header", "Brightwave Analytics", "Platform Engineer", "Denver, CO", "2018—2021"),
        _bullet(
            "r.exp1.b0",
            "Boosted throughput 500% after the rewrite",  # 500% is unconfirmed anywhere
            sources=[
                {
                    "file": "cv.md",
                    "quote": "Built the ingestion pipeline that handled 3x more throughput after the rewrite.",
                }
            ],
        ),
    ]
    result = _verify(units)

    # r.exp1.b0 was dropped (unconfirmed number); everything else survived
    # rule-level verification, including r.exp1.header (rule 3 doesn't know
    # or care that its only bullet failed).
    assert _survivor_ids(result) == {"r.exp0.header", "r.exp0.b0", "r.exp1.header"}
    assert _dropped_reasons(result) == {"r.exp1.b0": claims.REASON_NUMBER_NOT_CONFIRMED}

    # The render rule cascades: exp1's header is excluded too, since it has
    # zero surviving bullets. exp0's header stays because r.exp0.b0 survived.
    renderable = claims.drop_unverified(result)
    assert renderable == {"r.exp0.header", "r.exp0.b0"}


def test_drop_unverified_keeps_non_experience_units_untouched() -> None:
    # A summary/skill/cl_sentence unit id doesn't match the exp-header/
    # exp-bullet id convention at all, so the cascade must leave it alone.
    units = [
        _bullet(
            "r.summary",
            "Platform engineer focused on reliability at scale",
            kind="summary",
            sources=[
                {
                    "file": "cv.md",
                    "quote": "Drove adoption of the new observability stack across all engineering teams.",
                }
            ],
        ),
    ]
    result = _verify(units)
    assert _survivor_ids(result) == {"r.summary"}
    assert claims.drop_unverified(result) == {"r.summary"}


# ── Entity lexicon (context item #5) ──────────────────────────────────────


def test_entity_lexicon_is_built_from_cv_skills_section() -> None:
    lexicon = claims.build_entity_lexicon(CV_TEXT)
    assert "kubernetes" in lexicon
    assert "terraform" in lexicon
    assert "lambda" in lexicon  # split out of the multi-word "AWS Lambda" phrase
    assert "aws lambda" in lexicon  # the full phrase is kept too
    # Something never mentioned in Skills must NOT be in the lexicon —
    # otherwise the new-entity check for "Snowflake" above would be moot.
    assert "snowflake" not in lexicon


# ── Output shape ──────────────────────────────────────────────────────────


def test_verify_claims_pins_doc_sha256_and_version() -> None:
    result = _verify([])
    assert result["version"] == 1
    assert result["doc_sha256"] == DOC_SHA
    assert result["units"] == []
    assert result["dropped"] == []
