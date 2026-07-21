"""tests/test_slug_probe.py — jobify.hunt.sources.slug_probe (HUNT2 P2 S4).

Mocked ``requests.get`` only — no live network, matching this repo's
`tests/test_hunt_jsearch_serpapi.py` convention. Covers slug-candidate
generation, the Greenhouse metadata-endpoint improvement (real
independent-metadata confidence, not the TS probe's token-overlap
proxy), Ashby's `organizationName` path, Lever's proxy-only path, and
the never-throws / no-hit degradation contract.
"""

from __future__ import annotations

from jobify.hunt.sources import slug_probe


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def _router(mapping: dict[str, tuple], default=None):
    """Return a fake ``requests.get`` that dispatches on URL substring."""

    def _fake_get(url, timeout=None, **kwargs):
        for needle, (payload, status) in mapping.items():
            if needle in url:
                return _FakeResponse(payload, status)
        if default is not None:
            payload, status = default
            return _FakeResponse(payload, status)
        return _FakeResponse({}, 404)

    return _fake_get


# ── generate_slug_candidates ──────────────────────────────────────────────


def test_generate_slug_candidates_multi_word():
    assert slug_probe.generate_slug_candidates("Acme Corp") == [
        {"slug": "acme-corp", "kind": "hyphenated"},
        {"slug": "acmecorp", "kind": "concatenated"},
        {"slug": "acme", "kind": "first-word"},
    ]


def test_generate_slug_candidates_strips_punctuation():
    assert slug_probe.generate_slug_candidates("Acme, Corp.") == [
        {"slug": "acme-corp", "kind": "hyphenated"},
        {"slug": "acmecorp", "kind": "concatenated"},
        {"slug": "acme", "kind": "first-word"},
    ]


def test_generate_slug_candidates_single_word():
    assert slug_probe.generate_slug_candidates("Stripe") == [{"slug": "stripe", "kind": "hyphenated"}]


def test_generate_slug_candidates_empty():
    assert slug_probe.generate_slug_candidates("   ") == []


# ── probe_company_slug ────────────────────────────────────────────────────


def test_greenhouse_metadata_endpoint_gives_real_confidence_not_proxy(monkeypatch):
    """The REQUIRED improvement over the TS probe: an exact metadata-name
    match yields full confidence, not the 0.9-discounted slug proxy."""
    monkeypatch.setattr(
        slug_probe.requests, "get",
        _router({
            "boards-api.greenhouse.io/v1/boards/acme-corp/jobs": ({"jobs": [{"title": "Engineer"}, {"title": "Designer"}]}, 200),
            "boards-api.greenhouse.io/v1/boards/acme-corp": ({"name": "Acme Corp"}, 200),
        }),
    )

    result = slug_probe.probe_company_slug("Acme Corp")

    assert result["found"] is True
    assert result["ats"] == "greenhouse"
    assert result["slug"] == "acme-corp"
    assert result["live_posting_count"] == 2
    assert result["metadata_name"] == "Acme Corp"
    assert result["confidence"] == 1.0
    assert result["titles"] == ["Engineer", "Designer"]


def test_greenhouse_falls_back_to_proxy_when_metadata_endpoint_fails(monkeypatch):
    monkeypatch.setattr(
        slug_probe.requests, "get",
        _router({
            "boards-api.greenhouse.io/v1/boards/acme-corp/jobs": ({"jobs": [{"title": "Engineer"}]}, 200),
            "boards-api.greenhouse.io/v1/boards/acme-corp": ({}, 404),
        }),
    )

    result = slug_probe.probe_company_slug("Acme Corp")

    assert result["found"] is True
    assert result["ats"] == "greenhouse"
    assert result["metadata_name"] is None
    # slug "acme-corp" fully overlaps company words -> 1.0 * 0.9 discount
    assert result["confidence"] == 0.9


def test_ashby_trusts_organization_name(monkeypatch):
    monkeypatch.setattr(
        slug_probe.requests, "get",
        _router({
            "api.ashbyhq.com/posting-api/job-board/acme": (
                {"organizationName": "Acme Corp", "jobs": [{"title": "SRE"}]}, 200,
            ),
        }),
    )

    result = slug_probe.probe_company_slug("Acme Corp")

    assert result["found"] is True
    assert result["ats"] == "ashby"
    assert result["confidence"] == 1.0
    assert result["titles"] == ["SRE"]


def test_ashby_penalizes_impostor_metadata_name(monkeypatch):
    monkeypatch.setattr(
        slug_probe.requests, "get",
        _router({
            "api.ashbyhq.com/posting-api/job-board/acme": (
                {"organizationName": "Acme Trucking Inc", "jobs": [{"title": "Driver"}]}, 200,
            ),
        }),
    )

    result = slug_probe.probe_company_slug("Acme")

    assert result["found"] is True
    assert result["confidence"] < 0.5


def test_lever_uses_slug_proxy_only(monkeypatch):
    monkeypatch.setattr(
        slug_probe.requests, "get",
        _router({
            "api.lever.co/v0/postings/acme": ([{"text": "Backend Engineer"}, {"text": "PM"}], 200),
        }),
    )

    result = slug_probe.probe_company_slug("Acme")

    assert result["found"] is True
    assert result["ats"] == "lever"
    assert result["live_posting_count"] == 2
    assert result["confidence"] == 0.9
    assert result["titles"] == ["Backend Engineer", "PM"]


def test_no_hit_on_any_ats_returns_not_found(monkeypatch):
    monkeypatch.setattr(slug_probe.requests, "get", lambda *a, **k: _FakeResponse({}, 404))

    result = slug_probe.probe_company_slug("Totally Unknown Company")

    assert result == {"found": False, "reason": "no matching board found on any ATS"}


def test_empty_company_name_never_hits_network(monkeypatch):
    calls = []
    monkeypatch.setattr(slug_probe.requests, "get", lambda *a, **k: calls.append(1))

    result = slug_probe.probe_company_slug("   ")

    assert result == {"found": False, "reason": "empty company name"}
    assert calls == []


def test_network_error_never_raises(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("network is down")

    monkeypatch.setattr(slug_probe.requests, "get", _boom)

    result = slug_probe.probe_company_slug("Acme Corp")

    assert result["found"] is False
