"""tests/test_hosted_candidates.py — jobify.hosted.candidates (HUNT2 P2 S4).

No live network, no live Supabase: `jobify.db` is monkeypatched with an
in-memory fake (matching this repo's `tests/test_hosted_discovery.py` /
`tests/test_hosted_fanout.py` convention of faking the source-fetcher and
DB layers), and `jobify.hunt.sources.slug_probe` is monkeypatched per
test to return a scripted probe result instead of hitting real ATS APIs.
"""

from __future__ import annotations

import pytest

from jobify.hosted import candidates
from jobify.hunt.sources import slug_probe


class _FakeDb:
    """Minimal in-memory stand-in for the `candidate_boards` /
    `board_catalog` slice of `jobify.db` this module touches."""

    def __init__(self):
        self.candidate_rows: dict[str, dict] = {}  # normalized_name -> row
        self.catalog_rows: list[dict] = []
        self._next_id = 1

    def get_candidate_board(self, normalized_name):
        return self.candidate_rows.get(normalized_name)

    def list_board_catalog_rows(self):
        return list(self.catalog_rows)

    def insert_candidate_board(self, **fields):
        row = {"id": str(self._next_id), **fields}
        self._next_id += 1
        self.candidate_rows[fields["normalized_name"]] = row
        return row

    def update_candidate_board(self, candidate_id, **fields):
        for row in self.candidate_rows.values():
            if row["id"] == candidate_id:
                row.update(fields)

    def insert_board_catalog_row(self, *, ats, slug, company_name, tags, added_by):
        self.catalog_rows.append({
            "ats": ats, "slug": slug, "company_name": company_name,
            "tags": tags, "added_by": added_by, "status": "active",
        })


@pytest.fixture(autouse=True)
def fake_db(monkeypatch):
    fake = _FakeDb()
    monkeypatch.setattr(candidates, "db", fake)
    return fake


def _hit(**overrides):
    base = {
        "found": True,
        "ats": "greenhouse",
        "slug": "acme-corp",
        "confidence": 1.0,
        "live_posting_count": 3,
        "metadata_name": "Acme Corp",
        "titles": ["Platform Engineer", "SRE", "Account Executive"],
    }
    base.update(overrides)
    return base


def _miss(reason="no matching board found on any ATS"):
    return {"found": False, "reason": reason}


# ── normalize_company_name ────────────────────────────────────────────────


def test_normalize_company_name_strips_punctuation_and_case():
    assert candidates.normalize_company_name("Acme, Corp.") == "acme corp"
    assert candidates.normalize_company_name("  Acme   Corp  ") == "acme corp"
    assert candidates.normalize_company_name("") == ""


# ── derive_tags_from_titles ────────────────────────────────────────────────


def test_derive_tags_from_titles_dominant_keyword():
    titles = ["Site Reliability Engineer", "Platform Engineer", "Backend Engineer", "Recruiter"]
    tags = candidates.derive_tags_from_titles(titles)
    assert "infra" in tags


def test_derive_tags_from_titles_empty_when_no_signal():
    assert candidates.derive_tags_from_titles(["Office Manager", "Recruiter"]) == []


def test_derive_tags_from_titles_caps_at_three():
    titles = [
        "Site Reliability Engineer", "Frontend Engineer", "ML Engineer",
        "Fintech Payments Lead", "Enterprise B2B AE", "Startup Generalist",
    ]
    assert len(candidates.derive_tags_from_titles(titles)) <= 3


# ── enqueue: dedup ─────────────────────────────────────────────────────────


def test_enqueue_rejects_empty_company_name(fake_db):
    result = candidates.enqueue("   ", "manual")
    assert result["outcome"] == "invalid"
    assert not fake_db.candidate_rows


def test_enqueue_skips_when_already_in_candidate_queue_any_status(fake_db, monkeypatch):
    fake_db.candidate_rows["acme corp"] = {"id": "1", "status": "rejected"}
    calls = []
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: calls.append(1))

    result = candidates.enqueue("Acme Corp", "manual")

    assert result["outcome"] == "duplicate"
    assert calls == []  # never probes a known duplicate — cheap dedup check runs first


def test_enqueue_skips_when_already_in_board_catalog_by_name(fake_db, monkeypatch):
    fake_db.catalog_rows.append({"ats": "greenhouse", "slug": "acme", "company_name": "Acme Corp."})
    calls = []
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: calls.append(1))

    result = candidates.enqueue("Acme Corp", "manual")

    assert result["outcome"] == "duplicate"
    assert calls == []


# ── enqueue: probe + auto-admit ─────────────────────────────────────────────


def test_enqueue_inserts_pending_when_probe_misses(fake_db, monkeypatch):
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: _miss())

    result = candidates.enqueue("Totally Unknown Co", "hn_thread", "https://news.ycombinator.com/item?id=1")

    assert result["outcome"] == "inserted"
    assert result["auto_admitted"] is False
    row = fake_db.candidate_rows["totally unknown co"]
    assert row["status"] == "pending"
    assert row["probe_result"] == {"found": False, "reason": "no matching board found on any ATS"}
    assert not fake_db.catalog_rows


def test_enqueue_auto_admits_on_high_confidence_metadata_match(fake_db, monkeypatch):
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: _hit())

    result = candidates.enqueue("Acme Corp", "aggregator_match", "https://remoteok.com/l/123")

    assert result["outcome"] == "inserted"
    assert result["auto_admitted"] is True
    row = fake_db.candidate_rows["acme corp"]
    assert row["status"] == "auto_admitted"
    assert row["decided_at"] is not None
    # probe_result persisted WITHOUT the ephemeral titles list
    assert "titles" not in row["probe_result"]
    assert fake_db.catalog_rows == [{
        "ats": "greenhouse", "slug": "acme-corp", "company_name": "Acme Corp",
        "tags": ["infra", "devtools"], "added_by": "discovery", "status": "active",
    }]


# ── P3 S6: top_title_terms (auto-tag material for a later human approval) ──


def test_enqueue_persists_top_title_terms_instead_of_raw_titles(fake_db, monkeypatch):
    monkeypatch.setattr(
        slug_probe, "probe_company_slug",
        lambda *a, **k: _hit(titles=["Platform Engineer", "SRE", "Account Executive"]),
    )

    candidates.enqueue("Acme Corp", "manual", allow_auto_admit=False)

    row = fake_db.candidate_rows["acme corp"]
    assert "titles" not in row["probe_result"]
    # "platform" (from "Platform Engineer") and "sre" (from "SRE") both
    # fire the infra/devtools rule; "account executive" fires no rule in
    # the fixed vocabulary.
    assert row["probe_result"]["top_title_terms"] == ["platform", "sre"]


def test_enqueue_top_title_terms_empty_when_no_keyword_matches(fake_db, monkeypatch):
    monkeypatch.setattr(
        slug_probe, "probe_company_slug",
        lambda *a, **k: _hit(titles=["Office Manager", "Recruiter"]),
    )

    candidates.enqueue("Acme Corp", "manual", allow_auto_admit=False)

    assert fake_db.candidate_rows["acme corp"]["probe_result"]["top_title_terms"] == []


# ── P3 S6: skip_catalog_name_dedup (board_health's relocation proposals) ───


def test_enqueue_skip_catalog_name_dedup_bypasses_catalog_check(fake_db, monkeypatch):
    """`jobify.hosted.board_health` proposes a relocation for a company
    that's BY DEFINITION already in `board_catalog` (as the dead board
    itself) — without this flag, `_catalog_has_company` would always
    short-circuit to `duplicate` and no relocation could ever be
    proposed."""
    fake_db.catalog_rows.append({"ats": "greenhouse", "slug": "acme", "company_name": "Acme Corp"})
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: _hit(slug="acme-relocated"))

    result = candidates.enqueue(
        "Acme Corp", "relocation", skip_catalog_name_dedup=True, allow_auto_admit=False,
    )

    assert result["outcome"] == "inserted"
    # allow_auto_admit=False still holds even though skip_catalog_name_dedup
    # bypassed the OTHER dedup check — no silent auto-swap.
    assert result["auto_admitted"] is False
    assert fake_db.candidate_rows["acme corp"]["status"] == "pending"


def test_enqueue_skip_catalog_name_dedup_still_dedups_against_candidate_queue(fake_db, monkeypatch):
    """Dedup #1 (`candidate_boards`, ANY status) still applies even with
    `skip_catalog_name_dedup=True` — a dead board only ever gets ONE
    relocation candidate, ever."""
    fake_db.candidate_rows["acme corp"] = {"id": "1", "status": "rejected"}
    calls = []
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: calls.append(1))

    result = candidates.enqueue(
        "Acme Corp", "relocation", skip_catalog_name_dedup=True, allow_auto_admit=False,
    )

    assert result["outcome"] == "duplicate"
    assert calls == []


def test_enqueue_stays_pending_when_metadata_name_missing_lever_proxy(fake_db, monkeypatch):
    """Lever never exposes board metadata — every hit is the discounted
    slug-overlap proxy, so it must never auto-admit even at a high raw
    confidence score."""
    monkeypatch.setattr(
        slug_probe, "probe_company_slug",
        lambda *a, **k: _hit(ats="lever", slug="acme", metadata_name=None, confidence=0.9),
    )

    result = candidates.enqueue("Acme", "manual")

    assert result["auto_admitted"] is False
    assert result["would_auto_admit"] is False
    assert not fake_db.catalog_rows


def test_enqueue_stays_pending_below_confidence_threshold(fake_db, monkeypatch):
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: _hit(confidence=0.5))

    result = candidates.enqueue("Acme Corp", "manual")

    assert result["auto_admitted"] is False
    assert not fake_db.catalog_rows


def test_enqueue_stays_pending_with_zero_live_postings(fake_db, monkeypatch):
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: _hit(live_posting_count=0, titles=[]))

    result = candidates.enqueue("Acme Corp", "manual")

    assert result["auto_admitted"] is False
    assert not fake_db.catalog_rows


def test_enqueue_stays_pending_when_board_already_catalogued_by_ats_slug(fake_db, monkeypatch):
    fake_db.catalog_rows.append({"ats": "greenhouse", "slug": "acme-corp", "company_name": "Acme Corp (dup)"})
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: _hit())

    result = candidates.enqueue("Acme Corp Two", "manual")

    assert result["auto_admitted"] is False
    assert len(fake_db.catalog_rows) == 1


def test_enqueue_with_known_slug_uses_probe_known_slug(fake_db, monkeypatch):
    seen = {}

    def _fake_probe_known(company_name, ats, slug, **kwargs):
        seen["args"] = (company_name, ats, slug)
        return _hit(ats=ats, slug=slug)

    monkeypatch.setattr(slug_probe, "probe_known_slug", _fake_probe_known)

    result = candidates.enqueue(
        "Acme Corp", "hn_thread", "https://news.ycombinator.com/item?id=1",
        proposed_ats="ashby", proposed_slug="acmecorp",
    )

    assert seen["args"] == ("Acme Corp", "ashby", "acmecorp")
    assert result["auto_admitted"] is True


def test_enqueue_allow_auto_admit_false_leaves_row_pending(fake_db, monkeypatch):
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: _hit())

    result = candidates.enqueue("Acme Corp", "manual", allow_auto_admit=False)

    assert result["outcome"] == "inserted"
    assert result["auto_admitted"] is False
    assert result["would_auto_admit"] is True
    assert fake_db.candidate_rows["acme corp"]["status"] == "pending"
    assert not fake_db.catalog_rows


# ── run_candidates_cycle ───────────────────────────────────────────────────


def test_run_candidates_cycle_dedups_within_batch(fake_db, monkeypatch):
    calls = []

    def _fake_probe(company_name, **kwargs):
        calls.append(company_name)
        return _hit()

    monkeypatch.setattr(slug_probe, "probe_company_slug", _fake_probe)

    counters = candidates.run_candidates_cycle([
        {"company_name": "Acme Corp", "evidence_kind": "hn_thread"},
        {"company_name": "acme corp", "evidence_kind": "aggregator_match"},
    ])

    assert calls == ["Acme Corp"]
    assert counters["seen"] == 2
    assert counters["inserted"] == 1
    assert counters["duplicate"] == 1


def test_run_candidates_cycle_enforces_enqueue_cap(fake_db, monkeypatch):
    monkeypatch.setattr(candidates, "ENQUEUE_CAP_PER_CYCLE", 2)
    monkeypatch.setattr(slug_probe, "probe_company_slug", lambda *a, **k: _miss())

    counters = candidates.run_candidates_cycle([
        {"company_name": f"Company {i}", "evidence_kind": "manual"} for i in range(5)
    ])

    assert counters["inserted"] == 2
    assert counters["dropped_enqueue_cap"] == 3


def test_run_candidates_cycle_enforces_auto_admit_cap_but_still_probes(fake_db, monkeypatch):
    monkeypatch.setattr(candidates, "AUTO_ADMIT_CAP_PER_CYCLE", 1)
    monkeypatch.setattr(
        slug_probe, "probe_company_slug",
        lambda company_name, **k: _hit(slug=candidates.normalize_company_name(company_name).replace(" ", "-")),
    )

    counters = candidates.run_candidates_cycle([
        {"company_name": "Company A", "evidence_kind": "manual"},
        {"company_name": "Company B", "evidence_kind": "manual"},
    ])

    assert counters["inserted"] == 2
    assert counters["auto_admitted"] == 1
    assert counters["dropped_auto_admit_cap"] == 1
    # the capped one still got probed and inserted as pending, not skipped entirely
    pending = [r for r in fake_db.candidate_rows.values() if r["status"] == "pending"]
    assert len(pending) == 1


def test_run_candidates_cycle_one_bad_candidate_does_not_abort_cycle(fake_db, monkeypatch):
    def _fake_probe(company_name, **kwargs):
        if company_name == "Boom Inc":
            raise RuntimeError("network blew up")
        return _miss()

    monkeypatch.setattr(slug_probe, "probe_company_slug", _fake_probe)

    counters = candidates.run_candidates_cycle([
        {"company_name": "Boom Inc", "evidence_kind": "manual"},
        {"company_name": "Fine Co", "evidence_kind": "manual"},
    ])

    assert counters["errored"] == 1
    assert counters["inserted"] == 1
