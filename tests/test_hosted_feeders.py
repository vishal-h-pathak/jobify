"""tests/test_hosted_feeders.py — jobify.hosted.feeders.{hn,aggregator,
serpapi_dork} (HUNT2 P2 S4).

Each feeder is a pure read + transform: no live network, no live
Supabase — `jobify.db` is monkeypatched per test (matching
`tests/test_hosted_candidates.py`'s in-memory-fake convention), and
`serpapi_dork`'s own HTTP call (`sources._http.fetch_json`) is
monkeypatched separately since it bypasses `jobify.db` entirely.
"""

from __future__ import annotations

import pytest

from jobify.hosted.feeders import _ats_url, aggregator, hn, serpapi_dork


# ── _ats_url.parse_ats_slug ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://boards.greenhouse.io/acmeco/jobs/12345", ("greenhouse", "acmeco")),
        ("https://job-boards.greenhouse.io/acmeco/jobs/999", ("greenhouse", "acmeco")),
        ("https://jobs.lever.co/acmeco/abc-123", ("lever", "acmeco")),
        ("https://jobs.ashbyhq.com/AcmeCo/uuid-here", ("ashby", "acmeco")),
        ("https://acme.com/careers?ashby_jid=xyz", (None, None)),  # widget embed, no host match
        ("https://example.com/jobs/1", (None, None)),
        ("", (None, None)),
    ],
)
def test_parse_ats_slug(url, expected):
    assert _ats_url.parse_ats_slug(url) == expected


# ── hn.extract_candidates ─────────────────────────────────────────────────


class _FakeDbHn:
    def __init__(self, postings):
        self._postings = postings

    def list_postings_by_source(self, source):
        assert source == "hn_whoshiring"
        return self._postings


def test_hn_extract_candidates_only_direct_ats_links(monkeypatch):
    postings = [
        {"company": "Acme Co", "application_url": "https://boards.greenhouse.io/acmeco/jobs/1"},
        {"company": "No ATS Co", "application_url": "https://example.com/careers"},
        {"company": "", "application_url": "https://jobs.lever.co/beta/2"},
    ]
    monkeypatch.setattr(hn, "db", _FakeDbHn(postings))

    result = hn.extract_candidates()

    assert result == [
        {
            "company_name": "Acme Co", "evidence_kind": "hn_thread",
            "evidence_url": "https://boards.greenhouse.io/acmeco/jobs/1",
            "proposed_ats": "greenhouse", "proposed_slug": "acmeco",
        },
        {
            "company_name": "beta", "evidence_kind": "hn_thread",
            "evidence_url": "https://jobs.lever.co/beta/2",
            "proposed_ats": "lever", "proposed_slug": "beta",
        },
    ]


def test_hn_extract_candidates_dedups_by_ats_slug(monkeypatch):
    postings = [
        {"company": "Acme Co", "application_url": "https://boards.greenhouse.io/acmeco/jobs/1"},
        {"company": "Acme Co (dup posting)", "application_url": "https://boards.greenhouse.io/acmeco/jobs/2"},
    ]
    monkeypatch.setattr(hn, "db", _FakeDbHn(postings))

    result = hn.extract_candidates()

    assert len(result) == 1


# ── aggregator.route_candidates ─────────────────────────────────────────


class _FakeDbAggregator:
    def __init__(self, matches, postings, catalog_rows):
        self._matches = matches
        self._postings = {p["id"]: p for p in postings}
        self._catalog_rows = catalog_rows

    def list_non_title_rejected_matches(self):
        return [m for m in self._matches if m.get("status") != "rejected_title"]

    def get_postings_by_ids(self, ids):
        return [self._postings[i] for i in ids if i in self._postings]

    def list_board_catalog_rows(self):
        return self._catalog_rows


def test_aggregator_routes_unknown_company_from_surviving_match(monkeypatch):
    matches = [{"posting_id": "p1", "status": "surfaced"}, {"posting_id": "p2", "status": "rejected_title"}]
    postings = [
        {"id": "p1", "source": "remoteok", "company": "Unknown Co", "application_url": "https://unknownco.com/apply"},
        {"id": "p2", "source": "remoteok", "company": "Also Unknown", "application_url": ""},
    ]
    monkeypatch.setattr(aggregator, "db", _FakeDbAggregator(matches, postings, []))

    result = aggregator.route_candidates()

    assert result == [{
        "company_name": "Unknown Co", "evidence_kind": "aggregator_match",
        "evidence_url": "https://unknownco.com/apply",
    }]


def test_aggregator_skips_portal_sourced_postings(monkeypatch):
    matches = [{"posting_id": "p1", "status": "surfaced"}]
    postings = [{"id": "p1", "source": "greenhouse", "company": "Tracked Co", "application_url": ""}]
    monkeypatch.setattr(aggregator, "db", _FakeDbAggregator(matches, postings, []))

    assert aggregator.route_candidates() == []


def test_aggregator_skips_company_already_in_catalog(monkeypatch):
    matches = [{"posting_id": "p1", "status": "surfaced"}]
    postings = [{"id": "p1", "source": "remoteok", "company": "Acme Corp.", "application_url": ""}]
    catalog_rows = [{"ats": "greenhouse", "slug": "acme", "company_name": "Acme Corp"}]
    monkeypatch.setattr(aggregator, "db", _FakeDbAggregator(matches, postings, catalog_rows))

    assert aggregator.route_candidates() == []


def test_aggregator_proposes_slug_when_application_url_is_direct_ats_link(monkeypatch):
    matches = [{"posting_id": "p1", "status": "surfaced"}]
    postings = [{
        "id": "p1", "source": "serpapi", "company": "Acme Co",
        "application_url": "https://jobs.ashbyhq.com/acme/job-id",
    }]
    monkeypatch.setattr(aggregator, "db", _FakeDbAggregator(matches, postings, []))

    result = aggregator.route_candidates()

    assert result == [{
        "company_name": "Acme Co", "evidence_kind": "aggregator_match",
        "evidence_url": "https://jobs.ashbyhq.com/acme/job-id",
        "proposed_ats": "ashby", "proposed_slug": "acme",
    }]


def test_aggregator_returns_empty_when_no_surviving_matches(monkeypatch):
    monkeypatch.setattr(aggregator, "db", _FakeDbAggregator([], [], []))
    assert aggregator.route_candidates() == []


# ── serpapi_dork.dork_candidates ──────────────────────────────────────────


class _FakeDbSerpapiDork:
    def __init__(self, user_ids):
        self._user_ids = user_ids

    def list_profile_user_ids(self):
        return self._user_ids


def test_serpapi_dork_skips_cleanly_without_api_key(monkeypatch):
    monkeypatch.delenv("SERPAPI_KEY", raising=False)
    assert serpapi_dork.dork_candidates() == []


def test_serpapi_dork_skips_when_no_prefer_substrings(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "fake-key")
    monkeypatch.setattr(serpapi_dork, "db", _FakeDbSerpapiDork([]))
    assert serpapi_dork.dork_candidates() == []


def test_serpapi_dork_parses_slugs_from_organic_results(monkeypatch, tmp_path):
    monkeypatch.setenv("SERPAPI_KEY", "fake-key")
    monkeypatch.setattr(serpapi_dork, "db", _FakeDbSerpapiDork(["user-a"]))
    monkeypatch.setattr(
        serpapi_dork, "materialize_profile_dir", lambda user_id: tmp_path,
    )
    monkeypatch.setattr(
        serpapi_dork, "load_portals",
        lambda profile_dir: {"title_filter": {"prefer_substrings": ["platform engineer"]}},
    )

    calls = []

    def _fake_fetch_json(url, **kwargs):
        calls.append(url)
        if "boards.greenhouse.io" in url:
            return {"organic_results": [
                {"title": "Acme Corp - Platform Engineer", "link": "https://boards.greenhouse.io/acmeco/jobs/1"},
            ]}
        return {"organic_results": []}

    monkeypatch.setattr(serpapi_dork, "fetch_json", _fake_fetch_json)
    monkeypatch.setattr(serpapi_dork, "DORK_MAX_SEARCHES", 5)

    result = serpapi_dork.dork_candidates()

    assert result == [{
        "company_name": "Acme Corp - Platform Engineer",
        "evidence_kind": "serpapi_dork",
        "evidence_url": "https://boards.greenhouse.io/acmeco/jobs/1",
        "proposed_ats": "greenhouse",
        "proposed_slug": "acmeco",
    }]
    assert len(calls) <= 5


def test_serpapi_dork_respects_search_budget_cap(monkeypatch, tmp_path):
    monkeypatch.setenv("SERPAPI_KEY", "fake-key")
    monkeypatch.setattr(serpapi_dork, "db", _FakeDbSerpapiDork(["user-a"]))
    monkeypatch.setattr(serpapi_dork, "materialize_profile_dir", lambda user_id: tmp_path)
    monkeypatch.setattr(
        serpapi_dork, "load_portals",
        lambda profile_dir: {"title_filter": {"prefer_substrings": ["a", "b", "c", "d", "e"]}},
    )
    monkeypatch.setattr(serpapi_dork, "DORK_MAX_SEARCHES", 2)

    calls = []

    def _fake_fetch_json(url, **kwargs):
        calls.append(url)
        return {"organic_results": []}

    monkeypatch.setattr(serpapi_dork, "fetch_json", _fake_fetch_json)

    serpapi_dork.dork_candidates()

    assert len(calls) == 2
