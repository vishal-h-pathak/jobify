"""tests/test_hunt_sources_metadata.py — HUNT2 S3 (session 50):

  1. Lever fetcher wiring: mocked payload, section iteration, remote
     inference, `apply_title_filter` bypass — the fetcher existed but was
     never exercised end-to-end (planning/HUNT2_SOURCES.md §3.4).
  2. Workday CXS fetcher: mocked list + detail payloads, pagination cap,
     tenant-error graceful degradation, plus one live smoke test behind an
     env flag (excluded by default — no network in the default suite).
  3. Metadata extraction (migration 0016, §3.5): every portal fetcher
     (greenhouse/lever/ashby/workday) plus jsearch now persists `raw` and
     extracts `posted_at`/`department`/`employment_type`/
     `comp_min`/`comp_max`/`comp_currency` where its API provides them.
     Field names/shapes below are pinned against LIVE payloads fetched
     during this session (Ashby's `compensation.summaryComponents`
     against api.ashbyhq.com/posting-api/job-board/openai; Workday's
     `jobPostingInfo.startDate` against target.wd5/homedepot.wd5 — see
     the session report for the raw responses).
  4. Post-merge-review fix: `remote` — a real tri-state value every
     fetcher computes via `sources.remote_infer.infer_remote` — was being
     silently dropped at `jobify.db.upsert_posting`'s write boundary,
     severing P0.2/P0.7 end-to-end (see `jobify/db.py::upsert_posting`'s
     docstring). `test_fetcher_remote_value_survives_db_round_trip_into_rubric_tier`
     below threads a fetcher's computed `remote` through the SAME fake
     Supabase client mechanism `tests/test_db_hosted.py` uses, into
     `db.get_unmatched_postings` (the exact read `jobify.hosted.fanout`
     calls), and into `jobify.hunt.rubric`'s location-tier decision — the
     full path a regression here would silently break. Honesty note: the
     fake Supabase double does not persist across separate write/read
     calls (matching every other test in this suite's convention), so
     this test manually seeds the fake's `postings` table with the exact
     payload `upsert_posting` sent, rather than claiming a live DB round
     trip — the seam this proves is real (payload includes `remote`,
     `get_unmatched_postings` returns it unchanged, `rubric` reads it
     correctly), just not read-after-write against a real database.

HTTP is mocked at the `fetch_json` seam throughout — no network in the
default suite, matching every other `tests/test_hunt_*sources*` file's
convention.
"""

from __future__ import annotations

import os

import pytest

from jobify import db
from jobify.hunt import rubric

# Importing `jobify.hosted.discovery` first runs `jobify.hunt.agent`'s
# sys.path bootstrap (inserts `jobify/hunt/` so the intra-subtree
# `sources` package below resolves as a top-level import) — same trick
# `tests/test_hosted_discovery.py` relies on.
from jobify.hosted import discovery  # noqa: F401
from sources import ashby, greenhouse, jsearch, lever, workday


# ── Greenhouse: department / employment_type / posted_at / raw ──────────


def _gh_payload(**overrides):
    job = {
        "id": 1,
        "title": "Platform Engineer",
        "location": {"name": "Remote"},
        "content": "<p>desc</p>",
        "absolute_url": "https://boards.greenhouse.io/acmeco/jobs/1",
        "updated_at": "2026-07-14T18:35:00-04:00",
        "first_published": "2026-06-22T10:35:43-04:00",
        "departments": [{"id": 1, "name": "Engineering"}],
        "metadata": [{"name": "Employment Type", "value": "Full-time"}],
    }
    job.update(overrides)
    return job


def test_greenhouse_extracts_metadata_and_raw(monkeypatch):
    monkeypatch.setattr(greenhouse, "fetch_json", lambda *a, **k: {"jobs": [_gh_payload()]})
    [job] = list(greenhouse.fetch([("acmeco", "Acme Co")], apply_title_filter=False))
    assert job["posted_at"] == "2026-06-22T10:35:43-04:00"
    assert job["department"] == "Engineering"
    assert job["employment_type"] == "Full-time"
    assert job["raw"]["id"] == 1


def test_greenhouse_missing_fields_extract_to_none(monkeypatch):
    payload = _gh_payload(departments=[], metadata=[], first_published=None, updated_at=None)
    monkeypatch.setattr(greenhouse, "fetch_json", lambda *a, **k: {"jobs": [payload]})
    [job] = list(greenhouse.fetch([("acmeco", "Acme Co")], apply_title_filter=False))
    assert job["posted_at"] is None
    assert job["department"] is None
    assert job["employment_type"] is None


# ── Lever: section iteration, dedup-relevant id, metadata, raw ──────────


def _lever_payload(**overrides):
    job = {
        "id": "abc-123",
        "text": "Director of Product",
        "categories": {"department": "Product", "commitment": "Full-time", "location": "Remote"},
        "createdAt": 1779209949302,
        "descriptionPlain": "Own the roadmap.",
        "hostedUrl": "https://jobs.lever.co/acmeco/abc-123",
        "applyUrl": "https://jobs.lever.co/acmeco/abc-123/apply",
    }
    job.update(overrides)
    return job


def test_lever_extracts_metadata_and_raw(monkeypatch):
    monkeypatch.setattr(lever, "fetch_json", lambda *a, **k: [_lever_payload()])
    [job] = list(lever.fetch([("acmeco", "Acme Co")], apply_title_filter=False))
    assert job["department"] == "Product"
    assert job["employment_type"] == "Full-time"
    assert job["posted_at"] == "2026-05-19T16:59:09.302000+00:00"
    assert job["raw"]["id"] == "abc-123"
    assert job["id"]  # make_job_id produced a real, non-empty id


def test_lever_malformed_created_at_extracts_to_none(monkeypatch):
    monkeypatch.setattr(lever, "fetch_json", lambda *a, **k: [_lever_payload(createdAt="not-a-number")])
    [job] = list(lever.fetch([("acmeco", "Acme Co")], apply_title_filter=False))
    assert job["posted_at"] is None


def test_lever_fetches_every_board_section_in_portals(monkeypatch):
    """Section iteration: two Lever boards in the union target list both
    get fetched (not just the first)."""
    calls: list[str] = []

    def _fake(url, **kwargs):
        slug = url.split("/postings/")[1].split("?")[0]
        calls.append(slug)
        return [_lever_payload(id=f"{slug}-1", hostedUrl=f"https://jobs.lever.co/{slug}/1")]

    monkeypatch.setattr(lever, "fetch_json", _fake)
    monkeypatch.setattr(lever, "sleep_between_requests", lambda *a, **k: None)
    jobs = list(lever.fetch([("acmeco", "Acme Co"), ("betaco", "Beta Co")], apply_title_filter=False))
    assert calls == ["acmeco", "betaco"]
    assert {j["company"] for j in jobs} == {"Acme Co", "Beta Co"}


def test_lever_apply_title_filter_bypass(monkeypatch):
    monkeypatch.setattr(
        lever, "fetch_json",
        lambda *a, **k: [_lever_payload(text="Engineering Intern")],
    )
    monkeypatch.setattr(lever, "passes_title_filter", lambda title: False)
    jobs_bypassed = list(lever.fetch([("acmeco", "Acme Co")], apply_title_filter=False))
    assert len(jobs_bypassed) == 1
    jobs_filtered = list(lever.fetch([("acmeco", "Acme Co")], apply_title_filter=True))
    assert jobs_filtered == []


# ── Ashby: structured compensation, department, employment_type, raw ────


def _ashby_payload(**overrides):
    job = {
        "title": "Staff Engineer",
        "department": "Engineering",
        "employmentType": "FullTime",
        "location": "Remote",
        "publishedAt": "2026-03-12T16:38:15.322+00:00",
        "isListed": True,
        "jobUrl": "https://jobs.ashbyhq.com/acmeco/1",
        "applyUrl": "https://jobs.ashbyhq.com/acmeco/1/application",
        "descriptionHtml": "<p>desc</p>",
        "compensation": {
            "summaryComponents": [
                {
                    "compensationType": "Salary",
                    "currencyCode": "USD",
                    "minValue": 257000,
                    "maxValue": 335000,
                },
                {
                    "compensationType": "EquityCashValue",
                    "currencyCode": "USD",
                    "minValue": None,
                    "maxValue": None,
                },
            ],
        },
    }
    job.update(overrides)
    return job


def test_ashby_extracts_salary_component_not_equity(monkeypatch):
    monkeypatch.setattr(ashby, "fetch_json", lambda *a, **k: {"jobs": [_ashby_payload()]})
    [job] = list(ashby.fetch([("acmeco", "Acme Co")], apply_title_filter=False))
    assert job["comp_min"] == 257000
    assert job["comp_max"] == 335000
    assert job["comp_currency"] == "USD"
    assert job["department"] == "Engineering"
    assert job["employment_type"] == "FullTime"
    assert job["posted_at"] == "2026-03-12T16:38:15.322+00:00"
    assert job["raw"]["title"] == "Staff Engineer"


def test_ashby_no_compensation_extracts_to_none(monkeypatch):
    payload = _ashby_payload(compensation={})
    monkeypatch.setattr(ashby, "fetch_json", lambda *a, **k: {"jobs": [payload]})
    [job] = list(ashby.fetch([("acmeco", "Acme Co")], apply_title_filter=False))
    assert job["comp_min"] is None
    assert job["comp_max"] is None
    assert job["comp_currency"] is None


# ── Workday: pagination, detail merge, extraction, tenant-error handling ─


def _wd_list_page(paths):
    return {"jobPostings": [{"title": f"Role {p}", "locationsText": "Remote", "externalPath": f"/job/{p}"} for p in paths]}


def test_workday_extracts_metadata_and_raw(monkeypatch):
    monkeypatch.setattr(workday, "_post_search", lambda tenant, site, dc, offset: (
        _wd_list_page(["r1"]) if offset == 0 else {}
    ))
    monkeypatch.setattr(workday, "_fetch_job_detail", lambda tenant, site, dc, path: {
        "jobPostingInfo": {"startDate": "2026-07-20", "timeType": "Full time", "jobDescription": "<p>x</p>"},
    })
    [job] = list(workday.fetch(
        [{"tenant": "acme", "site": "External", "dc": "wd1", "name": "Acme", "limit_pages": 1}],
        apply_title_filter=False,
    ))
    assert job["posted_at"] == "2026-07-20T00:00:00+00:00"
    assert job["employment_type"] == "Full time"
    assert job["raw"]["detail"]["startDate"] == "2026-07-20"
    assert job["raw"]["list"]["title"] == "Role r1"


def test_workday_malformed_start_date_extracts_to_none(monkeypatch):
    monkeypatch.setattr(workday, "_post_search", lambda tenant, site, dc, offset: (
        _wd_list_page(["r1"]) if offset == 0 else {}
    ))
    monkeypatch.setattr(workday, "_fetch_job_detail", lambda tenant, site, dc, path: {
        "jobPostingInfo": {"startDate": "not-a-date", "timeType": "Full time"},
    })
    [job] = list(workday.fetch(
        [{"tenant": "acme", "site": "External", "dc": "wd1", "name": "Acme", "limit_pages": 1}],
        apply_title_filter=False,
    ))
    assert job["posted_at"] is None


def test_workday_tenant_error_logs_and_continues(monkeypatch, caplog):
    """A 404/500 tenant must not crash the whole fetch cycle — log +
    skip, same resilience contract every other source follows."""
    def _boom(tenant, site, dc, offset):
        raise RuntimeError("500 from wd CXS")

    monkeypatch.setattr(workday, "_post_search", _boom)
    with caplog.at_level("WARNING", logger="sources.workday"):
        jobs = list(workday.fetch(
            [{"tenant": "dead", "site": "External", "dc": "wd1", "name": "Dead Co"}],
            apply_title_filter=False,
        ))
    assert jobs == []
    assert any("fetch failed" in rec.message for rec in caplog.records)


@pytest.mark.skipif(
    not os.environ.get("WORKDAY_LIVE_SMOKE"),
    reason="live network smoke test — set WORKDAY_LIVE_SMOKE=1 to run",
)
def test_workday_live_smoke_against_real_tenants():
    """Live-verified during HUNT2 session 50 against three real public
    Workday tenants (micron.wd1/External, target.wd5/targetcareers,
    homedepot.wd5/CareerDepot) — see the session report. Excluded by
    default (no network in the default suite); run explicitly with
    WORKDAY_LIVE_SMOKE=1 to re-verify the CXS shape hasn't drifted."""
    rows = [
        {"tenant": "micron", "site": "External", "dc": "wd1", "name": "Micron", "limit_pages": 1},
    ]
    jobs = list(workday.fetch(rows, apply_title_filter=False))
    assert len(jobs) > 0
    assert all(j["company"] == "Micron" for j in jobs)


# ── JSearch: best-effort extraction (documented schema, no live key) ────


def test_jsearch_extracts_documented_fields(monkeypatch):
    monkeypatch.setenv("JSEARCH_API_KEY", "fake-key")

    class _FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "data": [
                    {
                        "job_title": "Backend Engineer",
                        "employer_name": "Acme Co",
                        "job_description": "desc",
                        "job_apply_link": "https://acme.example/jobs/1",
                        "job_is_remote": True,
                        "job_posted_at_datetime_utc": "2026-07-01T00:00:00.000Z",
                        "job_employment_type": "FULLTIME",
                        "job_min_salary": 120000,
                        "job_max_salary": 150000,
                        "job_salary_currency": "USD",
                    },
                ],
            }

    monkeypatch.setattr(jsearch.requests, "get", lambda *a, **k: _FakeResp())
    monkeypatch.setattr(jsearch.time, "sleep", lambda *a, **k: None)

    [job] = list(jsearch.fetch(["backend engineer"]))
    assert job["posted_at"] == "2026-07-01T00:00:00.000Z"
    assert job["employment_type"] == "FULLTIME"
    assert job["comp_min"] == 120000
    assert job["comp_max"] == 150000
    assert job["comp_currency"] == "USD"
    assert job["raw"]["job_title"] == "Backend Engineer"


# ── Post-merge-review fix: remote survives upsert_posting -> ────────────
# get_unmatched_postings -> rubric location-tier (see module docstring §4)


class _FakeQuery:
    """Minimal chainable double for `.table(...).select|upsert|eq().execute()`
    — same shape as `tests/test_db_hosted.py`'s `_FakeQuery`, reimplemented
    locally rather than imported (that module's fakes are private to it)."""

    def __init__(self, rows):
        self._rows = list(rows)
        self.upsert_payload = None

    def select(self, *_a, **_k):
        return self

    def upsert(self, payload, on_conflict=None):
        self.upsert_payload = payload
        return self

    def eq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) == val]
        return self

    def execute(self):
        class _Result:
            def __init__(self, data):
                self.data = data
        return _Result(list(self._rows))


class _FakeClient:
    def __init__(self, tables=None):
        self._tables = tables or {}
        self.queries = []

    def table(self, name):
        q = _FakeQuery(self._tables.get(name, []))
        self.queries.append((name, q))
        return q


def _gh_payload_with_location(location_name: str):
    return _gh_payload(location={"name": location_name})


@pytest.mark.parametrize(
    "location_name, remote_value",
    [
        ("Remote", True),
        ("On-site - Austin, TX", False),
        ("Unknown", None),
    ],
)
def test_fetcher_remote_value_survives_db_round_trip_into_rubric_tier(
    monkeypatch, patch_db_client, location_name, remote_value,
):
    """A real fetcher (greenhouse) computes `remote` via
    `infer_remote` -> `db.upsert_posting` must persist it (it silently
    dropped it before this fix) -> `db.get_unmatched_postings` (the exact
    read `jobify.hosted.fanout` performs) must return it unchanged ->
    `jobify.hunt.rubric._location_tier` (P0.7) must compute the tier that
    value implies. A `base_location_substring` gate that does NOT match
    the onsite fixture's location ("Austin, TX") is used so all three
    remote states land on distinct tiers, proving the tier assignment
    isn't accidentally right for the wrong reason."""
    monkeypatch.setattr(
        greenhouse, "fetch_json",
        lambda *a, **k: {"jobs": [_gh_payload_with_location(location_name)]},
    )
    [job] = list(greenhouse.fetch([("acmeco", "Acme Co")], apply_title_filter=False))
    assert job["remote"] is remote_value, "fixture location didn't produce the intended remote value"

    write_client = _FakeClient()
    patch_db_client(write_client)
    db.upsert_posting(job)
    _, upsert_query = write_client.queries[-1]
    upserted_payload = upsert_query.upsert_payload
    assert upserted_payload["remote"] is remote_value

    read_client = _FakeClient({"postings": [upserted_payload], "matches": []})
    patch_db_client(read_client)
    [read_back] = db.get_unmatched_postings("user-x")
    assert read_back["remote"] is remote_value

    loc_gate = {"remote_acceptable": True, "base_location_substring": "Denver, CO"}
    tier = rubric._location_tier(loc_gate, read_back["remote"], read_back.get("location") or "")
    expected_tier = {True: 1, False: 3, None: 2}[remote_value]
    assert tier == expected_tier
