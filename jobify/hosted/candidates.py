"""jobify.hosted.candidates — the global candidate-board queue engine
(HUNT2 P2 S4, planning/HUNT2_SOURCES.md §4.1-4.2).

The leapfrog: the mechanism by which companies nobody hand-added enter
`board_catalog` (0015). Three feeders (`jobify.hosted.feeders.*`) each
surface candidate companies from a different signal — HN "Who is hiring?"
extraction, aggregator-unknown-company routing, SerpAPI ATS-site dorks —
and hand them to this module's `enqueue()`/`run_candidates_cycle()`,
which owns the queue's actual write path: dedup, the zero-LLM slug probe
(`jobify.hunt.sources.slug_probe`), the auto-admit decision, and
per-cycle volume rails. `jobify.hosted.worker` calls
`run_candidates_cycle()` once per hosted cycle, as a post-discovery step
clearly separated from discovery proper (module docstring there).

Zero LLM tokens anywhere in this module — the slug probe is pure HTTP/JSON
comparison, and auto-tagging (`derive_tags_from_titles`) is a keyword
lookup against the same fixed vocabulary `web/lib/portals/tierPacks.ts`
uses for tier-pack relevance (`infra, devtools, product, fintech,
data-ai, enterprise, growth-startup, big-tech-adjacent` — `remote-first`
is excluded here since it's a location signal, not derivable from titles).

Auto-admit rule (documented judgment call — spec says "probe confidence
high (metadata name match) AND live_posting_count > 0"): a candidate
auto-admits only when the probe's WINNING hit came from real independent
board metadata (Ashby's `organizationName`, or Greenhouse's board
metadata endpoint per `slug_probe`'s required improvement over the TS
probe) at or above `AUTO_ADMIT_CONFIDENCE_THRESHOLD`, with at least one
live posting, and the `(ats, slug)` isn't already catalogued. This
excludes Lever entirely from ever auto-admitting (no metadata endpoint
exists there — every Lever hit is the discounted slug-overlap proxy) and
excludes any Greenhouse hit whose metadata fetch itself failed — both
degrade to `pending` for human review via the admin candidates UI, which
is the intended, conservative default: liberal ENQUEUE, strict ADMIT.
"""

from __future__ import annotations

import logging
import math
import re
from datetime import datetime, timezone
from typing import Optional

from jobify import db
from jobify.hunt.sources import slug_probe

logger = logging.getLogger("jobify.hosted.candidates")

# Per-cycle volume rails (spec): at most this many NEW candidate_boards
# rows actually inserted, and at most this many of those auto-admitted,
# per `run_candidates_cycle` call. Duplicates/invalid names never count
# against either cap. Chosen as round, generous-but-bounded numbers for a
# queue that's brand new — revisit once real cycle volume is observed.
ENQUEUE_CAP_PER_CYCLE = 100
AUTO_ADMIT_CAP_PER_CYCLE = 25

# "Confidence high" (spec) — an exact metadata-name match scores 1.0; this
# threshold tolerates minor punctuation/suffix drift (" Inc", ", LLC")
# between the candidate's evidence-derived name and the ATS's own
# metadata name while still rejecting a token-overlap coincidence.
AUTO_ADMIT_CONFIDENCE_THRESHOLD = 0.85

_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")


def normalize_company_name(name: str) -> str:
    """Lowercased, punctuation-stripped dedup key — `candidate_boards
    .normalized_name` (0017) and the comparison key against
    `board_catalog.company_name`."""
    text = _PUNCT_RE.sub(" ", (name or "").lower())
    return _WS_RE.sub(" ", text).strip()


# ── Auto-tagging: dominant title keywords -> catalog tag vocabulary ──────
# Mirrors `web/lib/portals/tierPacks.ts::KEYWORD_TAG_RULES` (same fixed
# vocabulary, see `jobify/data/board_catalog_seed.yml`'s header comment)
# applied per-posting-title here instead of per-targeting-tier there.

_KEYWORD_TAG_RULES: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("infra", "platform", "sre", "site reliability", "devops", "backend"), ("infra", "devtools")),
    (("frontend", "front-end", "full stack", "fullstack", "product engineer", "ui engineer"), ("product",)),
    (("ml", "machine learning", "ai ", " ai", "data scientist", "data engineer", "research scientist"), ("data-ai",)),
    (("fintech", "payments", "trading systems"), ("fintech",)),
    (("enterprise", "b2b"), ("enterprise",)),
    (("startup", "early stage", "early-stage"), ("growth-startup",)),
    (("faang", "big tech", "large scale", "large-scale"), ("big-tech-adjacent",)),
)

# A tag must fire on at least this share of the board's live posting
# titles to count as "dominant" — one stray title mentioning "fintech"
# on an otherwise generic board shouldn't tag the whole company.
_MIN_TITLE_SHARE = 0.15
_MAX_TAGS = 3


def derive_tags_from_titles(titles: list[str]) -> list[str]:
    """Zero-LLM auto-tag derivation from a board's own live posting
    titles. Returns at most `_MAX_TAGS` tags, most-matched first; an
    empty list when nothing crosses the dominance threshold — an
    unconfident guess is worse than no tag (the admin UI / a future
    tier-pack refresh can always add tags by hand later).
    """
    if not titles:
        return []
    counts: dict[str, int] = {}
    for raw_title in titles:
        text = f" {(raw_title or '').lower()} "
        for keywords, tags in _KEYWORD_TAG_RULES:
            if any(kw in text for kw in keywords):
                for tag in tags:
                    counts[tag] = counts.get(tag, 0) + 1
    threshold = max(1, math.ceil(len(titles) * _MIN_TITLE_SHARE))
    ranked = sorted((t for t, c in counts.items() if c >= threshold), key=lambda t: -counts[t])
    return ranked[:_MAX_TAGS]


# ── Dedup + auto-admit decision ───────────────────────────────────────────


def _catalog_has_company(catalog_rows: list[dict], normalized_name: str) -> bool:
    return any(normalize_company_name(r.get("company_name") or "") == normalized_name for r in catalog_rows)


def _catalog_has_board(catalog_rows: list[dict], ats: Optional[str], slug: Optional[str]) -> bool:
    if not ats or not slug:
        return False
    return any(r.get("ats") == ats and r.get("slug") == slug for r in catalog_rows)


def _should_auto_admit(probe_result: dict, catalog_rows: list[dict]) -> bool:
    if not probe_result.get("found"):
        return False
    if not probe_result.get("metadata_name"):
        return False
    if (probe_result.get("confidence") or 0.0) < AUTO_ADMIT_CONFIDENCE_THRESHOLD:
        return False
    if not probe_result.get("live_posting_count"):
        return False
    if _catalog_has_board(catalog_rows, probe_result.get("ats"), probe_result.get("slug")):
        return False
    return True


def _matched_title_terms(titles: list[str]) -> list[str]:
    """Compact, replayable derivative of a probe's live posting titles:
    which fixed-vocabulary keyword phrases (`_KEYWORD_TAG_RULES`) actually
    appeared across them — NOT the titles themselves. Persisted to
    `probe_result.top_title_terms` (P3 S6 flag: the raw `titles` list was
    previously dropped entirely by `_compact_probe_result`, leaving a
    later human APPROVAL — `web/lib/admin/candidates.ts::approveCandidate`
    — with nothing to auto-tag from, unlike the discovery loop's own
    auto-admit path which still has the live `titles` in hand at enqueue
    time). The admin approve route re-derives tags from these terms via
    the SAME fixed vocabulary, ported to TS as
    `web/lib/portals/tierPacks.ts::deriveTagsFromKeywords` — feeding it
    `top_title_terms.join(" ")` reuses that function directly rather than
    duplicating `_KEYWORD_TAG_RULES` a third time.
    """
    matched: list[str] = []
    for raw_title in titles:
        text = f" {(raw_title or '').lower()} "
        for keywords, _tags in _KEYWORD_TAG_RULES:
            for kw in keywords:
                if kw in text and kw not in matched:
                    matched.append(kw)
    return matched


def _compact_probe_result(probe_result: dict) -> dict:
    """Trim the probe's ephemeral `titles` list before persisting to the
    `probe_result` jsonb column — full titles only ever existed to drive
    `derive_tags_from_titles` at enqueue time, not for later replay, but
    `top_title_terms` (a bounded, fixed-vocabulary derivative — see
    `_matched_title_terms`) IS kept, so a later human approval still has
    real auto-tag material instead of none."""
    if not probe_result.get("found"):
        return {"found": False, "reason": probe_result.get("reason")}
    return {
        "found": True,
        "ats": probe_result.get("ats"),
        "slug": probe_result.get("slug"),
        "confidence": probe_result.get("confidence"),
        "live_posting_count": probe_result.get("live_posting_count"),
        "metadata_name": probe_result.get("metadata_name"),
        "top_title_terms": _matched_title_terms(probe_result.get("titles") or []),
    }


# ── enqueue ────────────────────────────────────────────────────────────


def enqueue(
    company_name: str,
    evidence_kind: str,
    evidence_url: Optional[str] = None,
    *,
    proposed_ats: Optional[str] = None,
    proposed_slug: Optional[str] = None,
    catalog_rows: Optional[list[dict]] = None,
    allow_auto_admit: bool = True,
    skip_catalog_name_dedup: bool = False,
) -> dict:
    """Enqueue one candidate company: dedup, probe, maybe auto-admit.

    Dedup (checked BEFORE any write, in this order — both are zero-cost
    reads relative to the probe below):
      1. `candidate_boards`, ANY status, by `normalized_name` — a
         REJECTED candidate is never re-proposed.
      2. `board_catalog`, by normalized company name — already tracked
         under a possibly different evidence path. Skipped when
         `skip_catalog_name_dedup=True` (P3 S6's `evidence_kind=
         "relocation"` caller, `jobify.hosted.board_health` — the
         company is BY DEFINITION already in `board_catalog` as the dead
         board itself, so this check would otherwise always fire and no
         relocation could ever be proposed; dedup #1 above still applies,
         so a given dead board only ever gets ONE relocation candidate,
         ever, same as any other candidate).
    Either hit short-circuits to `{"outcome": "duplicate", ...}` with
    zero writes.

    `proposed_ats`/`proposed_slug` (HN + SerpAPI-dork feeders parse these
    straight out of an embedded ATS URL): when both are given, the probe
    verifies that SPECIFIC `(ats, slug)` pair (`slug_probe.probe_known_slug`)
    instead of guessing slug candidates from the company name — higher
    precision, same confidence/metadata contract.

    `catalog_rows` lets a batched caller (`run_candidates_cycle`) pass a
    pre-fetched, cycle-local `board_catalog` snapshot (mutated as the
    cycle auto-admits) instead of this function re-querying the whole
    table on every call; omitted (every standalone/test call) fetches
    fresh. `allow_auto_admit=False` lets the cycle-level
    `AUTO_ADMIT_CAP_PER_CYCLE` gate the WRITE without skipping the probe
    itself — the candidate still gets a real `probe_result` and stays
    `pending` for human review rather than silently missing one.

    Returns `{"outcome": "invalid"|"duplicate"|"inserted", "auto_admitted",
    "would_auto_admit", "candidate_id", "ats", "slug"}`. `would_auto_admit`
    is the pre-cap-gate verdict — a cycle can tell "probe qualified but
    the cap said no" apart from "probe didn't qualify" for its own
    logging.
    """
    company_name = (company_name or "").strip()
    normalized = normalize_company_name(company_name)
    if not company_name or not normalized:
        return {
            "outcome": "invalid", "auto_admitted": False, "would_auto_admit": False,
            "candidate_id": None, "ats": None, "slug": None,
        }

    if db.get_candidate_board(normalized) is not None:
        return {
            "outcome": "duplicate", "auto_admitted": False, "would_auto_admit": False,
            "candidate_id": None, "ats": None, "slug": None,
        }

    rows = catalog_rows if catalog_rows is not None else db.list_board_catalog_rows()
    if not skip_catalog_name_dedup and _catalog_has_company(rows, normalized):
        return {
            "outcome": "duplicate", "auto_admitted": False, "would_auto_admit": False,
            "candidate_id": None, "ats": None, "slug": None,
        }

    if proposed_ats and proposed_slug:
        probe_result = slug_probe.probe_known_slug(company_name, proposed_ats, proposed_slug)
    else:
        probe_result = slug_probe.probe_company_slug(company_name)

    row = db.insert_candidate_board(
        company_name=company_name,
        normalized_name=normalized,
        evidence_kind=evidence_kind,
        evidence_url=evidence_url,
        proposed_ats=probe_result.get("ats") or proposed_ats,
        proposed_slug=probe_result.get("slug") or proposed_slug,
        probe_result=_compact_probe_result(probe_result),
        status="pending",
    )
    candidate_id = row["id"]

    qualifies = _should_auto_admit(probe_result, rows)
    auto_admitted = False
    if qualifies and allow_auto_admit:
        tags = derive_tags_from_titles(probe_result.get("titles") or [])
        db.insert_board_catalog_row(
            ats=probe_result["ats"], slug=probe_result["slug"],
            company_name=company_name, tags=tags, added_by="discovery",
        )
        db.update_candidate_board(
            candidate_id, status="auto_admitted",
            decided_at=datetime.now(timezone.utc).isoformat(),
        )
        auto_admitted = True

    return {
        "outcome": "inserted",
        "auto_admitted": auto_admitted,
        "would_auto_admit": qualifies,
        "candidate_id": candidate_id,
        "ats": probe_result.get("ats"),
        "slug": probe_result.get("slug"),
    }


# ── run_candidates_cycle ──────────────────────────────────────────────────


def run_candidates_cycle(candidates: list[dict]) -> dict:
    """Batched enqueue pass — `jobify.hosted.worker`'s post-discovery step
    calls this once per cycle with the concatenated output of all three
    feeders (`jobify.hosted.feeders.hn.extract_candidates`,
    `.aggregator.route_candidates`, `.serpapi_dork.dork_candidates`).

    Each item: `{"company_name", "evidence_kind", "evidence_url"?,
    "proposed_ats"?, "proposed_slug"?}`.

    Enforces both volume rails for the WHOLE cycle (not per-feeder):
    `ENQUEUE_CAP_PER_CYCLE` new rows actually inserted, and
    `AUTO_ADMIT_CAP_PER_CYCLE` of those auto-admitted. Anything dropped
    past a cap is WARNING-logged (never silently discarded) and counted.
    Also dedups WITHIN this batch first (two feeders proposing the same
    company in one cycle skip the second probe entirely, cheaper than
    letting `enqueue()`'s own DB-level dedup catch it after a wasted
    probe). One candidate's failure (a DB hiccup, an unexpected probe
    exception — `slug_probe` itself never raises, but this is still
    per-item resilience matching every other hosted-cycle module's
    posture) is logged and skipped, never aborts the rest of the cycle.
    """
    counters = {
        "seen": 0,
        "duplicate": 0,
        "invalid": 0,
        "inserted": 0,
        "auto_admitted": 0,
        "dropped_enqueue_cap": 0,
        "dropped_auto_admit_cap": 0,
        "errored": 0,
    }
    seen_this_cycle: set[str] = set()
    catalog_rows = db.list_board_catalog_rows()

    for item in candidates:
        counters["seen"] += 1
        company_name = (item.get("company_name") or "").strip()
        normalized = normalize_company_name(company_name)
        if not company_name or not normalized:
            counters["invalid"] += 1
            continue
        if normalized in seen_this_cycle:
            counters["duplicate"] += 1
            continue
        seen_this_cycle.add(normalized)

        if counters["inserted"] >= ENQUEUE_CAP_PER_CYCLE:
            counters["dropped_enqueue_cap"] += 1
            logger.warning(
                "candidates: enqueue cap (%d) reached this cycle — dropping %r (%s)",
                ENQUEUE_CAP_PER_CYCLE, company_name, item.get("evidence_kind"),
            )
            continue

        allow_auto_admit = counters["auto_admitted"] < AUTO_ADMIT_CAP_PER_CYCLE
        try:
            result = enqueue(
                company_name,
                item.get("evidence_kind") or "manual",
                item.get("evidence_url"),
                proposed_ats=item.get("proposed_ats"),
                proposed_slug=item.get("proposed_slug"),
                catalog_rows=catalog_rows,
                allow_auto_admit=allow_auto_admit,
            )
        except Exception as exc:  # noqa: BLE001 — one bad candidate must not abort the cycle
            counters["errored"] += 1
            logger.error("candidates: enqueue failed for %r: %s", company_name, exc)
            continue

        if result["outcome"] == "duplicate":
            counters["duplicate"] += 1
            continue
        if result["outcome"] == "invalid":
            counters["invalid"] += 1
            continue

        counters["inserted"] += 1
        if result["auto_admitted"]:
            counters["auto_admitted"] += 1
            catalog_rows.append({
                "ats": result["ats"], "slug": result["slug"], "company_name": company_name,
            })
        elif result["would_auto_admit"]:
            counters["dropped_auto_admit_cap"] += 1
            logger.warning(
                "candidates: auto-admit cap (%d) reached this cycle — %r qualified but "
                "stays pending for manual review", AUTO_ADMIT_CAP_PER_CYCLE, company_name,
            )

    logger.info("candidates cycle done: %s", counters)
    return counters
