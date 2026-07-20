"""tests/test_hunt_jsearch_serpapi.py — jsearch.py / serpapi.py after the
P0.1 (location-agnostic) + P0.6 (per-user query templates) + P0.2
(remote tri-state) rewrite, HUNT2 session 47.

No live network: `requests.get` is monkeypatched with a tiny fake
response. Covers: explicit `queries=` wins over the active-profile
fallback, an empty query list no-ops without spending a request, and the
tri-state `remote` field lands on every yielded job dict.
"""

from __future__ import annotations

# Triggers jobify.hunt.agent's sys.path bootstrap (inserts jobify/hunt/ so
# the bare `sources.*` imports inside jsearch.py/serpapi.py resolve) —
# must run before importing either module below. See jsearch.py's own
# module docstring / jobify.hosted.fanout's for the same pattern.
import jobify.hunt.agent  # noqa: F401

import jobify.hunt.sources.jsearch as jsearch
import jobify.hunt.sources.serpapi as serpapi


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


# ── jsearch ──────────────────────────────────────────────────────────────


def test_jsearch_fetch_empty_queries_is_a_noop(monkeypatch):
    monkeypatch.setenv("JSEARCH_API_KEY", "fake-key")
    calls = []
    monkeypatch.setattr(jsearch.requests, "get", lambda *a, **k: calls.append(1))
    list(jsearch.fetch(queries=[]))
    assert calls == []


def test_jsearch_fetch_uses_explicit_queries_not_active_profile(monkeypatch):
    monkeypatch.setenv("JSEARCH_API_KEY", "fake-key")
    seen_queries = []

    def _fake_get(url, headers=None, params=None, timeout=None):
        seen_queries.append(params["query"])
        return _FakeResponse({"data": []})

    monkeypatch.setattr(jsearch.requests, "get", _fake_get)
    list(jsearch.fetch(queries=["Platform Engineer remote"]))
    assert seen_queries == ["Platform Engineer remote"]


def test_jsearch_fetch_remote_tri_state(monkeypatch):
    monkeypatch.setenv("JSEARCH_API_KEY", "fake-key")
    jobs = [
        {"job_title": "A", "employer_name": "Acme", "job_apply_link": "https://x/a",
         "job_city": "Denver", "job_state": "CO", "job_country": "US", "job_is_remote": False},
        {"job_title": "B", "employer_name": "Acme", "job_apply_link": "https://x/b",
         "job_is_remote": True},
        {"job_title": "C", "employer_name": "Acme", "job_apply_link": "https://x/c",
         "job_city": "Austin", "job_state": "TX"},  # no job_is_remote key at all
    ]
    monkeypatch.setattr(
        jsearch.requests, "get", lambda *a, **k: _FakeResponse({"data": jobs}),
    )
    results = list(jsearch.fetch(queries=["engineer"]))
    remote_by_title = {r["title"]: r["remote"] for r in results}
    assert remote_by_title == {"A": False, "B": True, "C": None}


# ── serpapi ──────────────────────────────────────────────────────────────


def test_serpapi_fetch_empty_queries_is_a_noop(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "fake-key")
    calls = []
    monkeypatch.setattr(serpapi.requests, "get", lambda *a, **k: calls.append(1))
    list(serpapi.fetch(queries=[]))
    assert calls == []


def test_serpapi_fetch_uses_explicit_queries_and_broad_location(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "fake-key")
    seen = []

    def _fake_get(url, params=None, timeout=None):
        seen.append((params["q"], params["location"]))
        return _FakeResponse({"jobs_results": []})

    monkeypatch.setattr(serpapi.requests, "get", _fake_get)
    list(serpapi.fetch(queries=["Product Designer Austin, TX"]))
    assert seen == [("Product Designer Austin, TX", "United States")]


def test_serpapi_fetch_infers_remote_from_location_text(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "fake-key")
    results_payload = {
        "jobs_results": [
            {"title": "A", "company_name": "Acme", "location": "Remote",
             "apply_options": [{"link": "https://x/a"}]},
            {"title": "B", "company_name": "Acme", "location": "Austin, TX (on-site)",
             "apply_options": [{"link": "https://x/b"}]},
            {"title": "C", "company_name": "Acme", "location": "Austin, TX",
             "apply_options": [{"link": "https://x/c"}]},
        ],
    }
    call_count = {"n": 0}

    def _fake_get(url, params=None, timeout=None):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return _FakeResponse(results_payload)
        return _FakeResponse({"jobs_results": []})  # page 2: stop pagination

    monkeypatch.setattr(serpapi.requests, "get", _fake_get)
    results = list(serpapi.fetch(queries=["engineer"]))
    remote_by_title = {r["title"]: r["remote"] for r in results}
    assert remote_by_title == {"A": True, "B": False, "C": None}
