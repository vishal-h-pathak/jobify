"""tests/test_hosted_board_health.py — jobify.hosted.board_health (HUNT2
P3 S6, planning/HUNT2_SOURCES.md §5).

No live network, no live Supabase/HTTP: `board_health._request` is
monkeypatched per test to return scripted `(status_code, body)` tuples
keyed by URL substring (mirroring this repo's `_FakeDb`-style convention
for source-fetcher tests), and `jobify.db` / `jobify.hosted.candidates`
are faked the same way `tests/test_hosted_candidates.py` does.
"""

from __future__ import annotations

from jobify.hosted import board_health, candidates


# ── _name_check_ok ────────────────────────────────────────────────────────


def test_name_check_ok_true_on_matching_names():
    assert board_health._name_check_ok("Acme Corp", "Acme Corp") is True


def test_name_check_ok_true_on_partial_overlap():
    assert board_health._name_check_ok("Acme Corp Inc", "Acme Corp") is True


def test_name_check_ok_false_on_mismatched_names():
    assert board_health._name_check_ok("Totally Different Company", "Acme Corp") is False


def test_name_check_ok_none_when_no_metadata_name():
    assert board_health._name_check_ok(None, "Acme Corp") is None


# ── per-ATS pollers ────────────────────────────────────────────────────────


def _script(responses: dict[str, tuple]):
    """`board_health._request` replacement: matches by URL substring, in
    the order given (first match wins) — good enough for these fixed,
    known URL shapes."""

    def _fake_request(url, *, method="GET", json_body=None):
        for needle, result in responses.items():
            if needle in url:
                return result
        raise AssertionError(f"unscripted URL: {url}")

    return _fake_request


def test_poll_greenhouse_healthy_board(monkeypatch):
    monkeypatch.setattr(board_health, "_request", _script({
        "/jobs?content=true": (200, {"jobs": [{"title": "SWE"}, {"title": "SRE"}]}),
        "/v1/boards/acme": (200, {"name": "Acme Corp"}),
    }))

    result = board_health._poll_greenhouse("acme", "Acme Corp")

    assert result == {"http_status": 200, "posting_count": 2, "name_check_ok": True}


def test_poll_greenhouse_dead_board_404(monkeypatch):
    monkeypatch.setattr(board_health, "_request", _script({
        "/jobs?content=true": (404, None),
        "/v1/boards/acme": (404, None),
    }))

    result = board_health._poll_greenhouse("acme", "Acme Corp")

    assert result == {"http_status": 404, "posting_count": None, "name_check_ok": None}


def test_poll_greenhouse_impostor_name_mismatch(monkeypatch):
    monkeypatch.setattr(board_health, "_request", _script({
        "/jobs?content=true": (200, {"jobs": [{"title": "SWE"}]}),
        "/v1/boards/acme": (200, {"name": "Some Squatter LLC"}),
    }))

    result = board_health._poll_greenhouse("acme", "Acme Corp")

    assert result["name_check_ok"] is False


def test_poll_ashby_reads_organization_name_from_one_call(monkeypatch):
    monkeypatch.setattr(board_health, "_request", _script({
        "ashbyhq.com": (200, {"jobs": [{"title": "SWE"}], "organizationName": "Acme Corp"}),
    }))

    result = board_health._poll_ashby("acme", "Acme Corp")

    assert result == {"http_status": 200, "posting_count": 1, "name_check_ok": True}


def test_poll_lever_never_runs_name_check(monkeypatch):
    monkeypatch.setattr(board_health, "_request", _script({
        "lever.co": (200, [{"text": "SWE"}, {"text": "PM"}]),
    }))

    result = board_health._poll_lever("acme", "Acme Corp")

    assert result == {"http_status": 200, "posting_count": 2, "name_check_ok": None}


def test_poll_workday_splits_slug_and_never_runs_name_check(monkeypatch):
    seen_urls = []

    def _fake_request(url, *, method="GET", json_body=None):
        seen_urls.append((url, method))
        return 200, {"jobPostings": [{"title": "SWE"}]}

    monkeypatch.setattr(board_health, "_request", _fake_request)

    result = board_health._poll_workday("acme/wd1/External", "Acme Corp")

    assert result == {"http_status": 200, "posting_count": 1, "name_check_ok": None}
    assert seen_urls == [("https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/jobs", "POST")]


def test_poll_workday_malformed_slug_is_exempt(monkeypatch):
    calls = []
    monkeypatch.setattr(board_health, "_request", lambda *a, **k: calls.append(1))

    result = board_health._poll_workday("not-a-valid-slug", "Acme Corp")

    assert result == {"http_status": None, "posting_count": None, "name_check_ok": None}
    assert calls == []


def test_poll_board_dispatches_by_ats(monkeypatch):
    monkeypatch.setitem(board_health._POLLERS, "greenhouse", lambda slug, name: {"marker": "greenhouse"})
    board = {"ats": "greenhouse", "slug": "acme", "company_name": "Acme Corp"}

    assert board_health.poll_board(board) == {"marker": "greenhouse"}


def test_poll_board_unknown_ats_degrades_to_all_none():
    board = {"ats": "some-future-ats", "slug": "acme", "company_name": "Acme Corp"}
    assert board_health.poll_board(board) == {"http_status": None, "posting_count": None, "name_check_ok": None}


# ── _is_dead ───────────────────────────────────────────────────────────────


def test_is_dead_on_404():
    assert board_health._is_dead({"http_status": 404, "posting_count": 5, "name_check_ok": True}, True) is True


def test_is_dead_on_410():
    assert board_health._is_dead({"http_status": 410, "posting_count": 5, "name_check_ok": True}, True) is True


def test_is_dead_on_failed_name_check():
    assert board_health._is_dead({"http_status": 200, "posting_count": 5, "name_check_ok": False}, True) is True


def test_is_dead_on_zero_postings_against_nonzero_baseline():
    assert board_health._is_dead({"http_status": 200, "posting_count": 0, "name_check_ok": None}, True) is True


def test_not_dead_on_zero_postings_with_no_baseline():
    """A board with no posting history yet (first-ever poll) isn't dead
    just because today's poll found nothing — there's no baseline to
    violate."""
    assert board_health._is_dead({"http_status": 200, "posting_count": 0, "name_check_ok": None}, False) is False


def test_not_dead_when_healthy():
    assert board_health._is_dead({"http_status": 200, "posting_count": 5, "name_check_ok": True}, True) is False


# ── run_board_health_cycle ───────────────────────────────────────────────


class _FakeDb:
    def __init__(self, catalog_rows, baseline_nonzero=True):
        self.catalog_rows = catalog_rows
        self.baseline_nonzero = baseline_nonzero
        self.health_rows: list[dict] = []
        self.status_updates: list[tuple] = []

    def list_board_catalog_rows(self):
        return self.catalog_rows

    def has_nonzero_board_health_baseline(self, board_id, since_day):
        return self.baseline_nonzero

    def upsert_board_health_row(self, **kwargs):
        self.health_rows.append(kwargs)

    def update_board_catalog_status(self, board_id, status):
        self.status_updates.append((board_id, status))


def test_run_board_health_cycle_healthy_board_no_alert(monkeypatch):
    fake_db = _FakeDb([{"id": "b1", "ats": "greenhouse", "slug": "acme", "company_name": "Acme Corp", "status": "active"}])
    monkeypatch.setattr(board_health, "db", fake_db)
    monkeypatch.setattr(
        board_health, "poll_board",
        lambda board: {"http_status": 200, "posting_count": 3, "name_check_ok": True},
    )
    enqueue_calls = []
    monkeypatch.setattr(candidates, "enqueue", lambda *a, **k: enqueue_calls.append((a, k)) or {"outcome": "inserted"})

    counters = board_health.run_board_health_cycle()

    assert counters == {"polled": 1, "dead_flagged": 0, "relocation_proposed": 0, "errored": 0}
    assert len(fake_db.health_rows) == 1
    assert fake_db.status_updates == []
    assert enqueue_calls == []


def test_run_board_health_cycle_flags_dead_board_and_proposes_relocation(monkeypatch):
    fake_db = _FakeDb([{"id": "b1", "ats": "greenhouse", "slug": "acme", "company_name": "Acme Corp", "status": "active"}])
    monkeypatch.setattr(board_health, "db", fake_db)
    monkeypatch.setattr(
        board_health, "poll_board",
        lambda board: {"http_status": 404, "posting_count": None, "name_check_ok": None},
    )
    enqueue_calls = []
    monkeypatch.setattr(
        candidates, "enqueue",
        lambda *a, **k: enqueue_calls.append((a, k)) or {"outcome": "inserted"},
    )

    counters = board_health.run_board_health_cycle()

    assert counters == {"polled": 1, "dead_flagged": 1, "relocation_proposed": 1, "errored": 0}
    assert fake_db.status_updates == [("b1", "dead")]
    (args, kwargs) = enqueue_calls[0]
    assert args[0] == "Acme Corp"
    assert args[1] == "relocation"
    assert kwargs["skip_catalog_name_dedup"] is True
    assert kwargs["allow_auto_admit"] is False


def test_run_board_health_cycle_skips_already_dead_boards(monkeypatch):
    """A board already marked dead doesn't get re-flagged/re-enqueued
    every cycle — candidate_boards' own dedup would no-op it anyway, but
    skipping keeps the per-cycle summary meaningful (NEW alerts only)."""
    fake_db = _FakeDb([{"id": "b1", "ats": "greenhouse", "slug": "acme", "company_name": "Acme Corp", "status": "dead"}])
    monkeypatch.setattr(board_health, "db", fake_db)
    monkeypatch.setattr(
        board_health, "poll_board",
        lambda board: {"http_status": 404, "posting_count": None, "name_check_ok": None},
    )
    enqueue_calls = []
    monkeypatch.setattr(candidates, "enqueue", lambda *a, **k: enqueue_calls.append(1) or {"outcome": "inserted"})

    counters = board_health.run_board_health_cycle()

    assert counters["dead_flagged"] == 0
    assert fake_db.status_updates == []
    assert enqueue_calls == []


def test_run_board_health_cycle_one_board_failure_does_not_abort_others(monkeypatch):
    fake_db = _FakeDb([
        {"id": "b1", "ats": "greenhouse", "slug": "broken", "company_name": "Broken Co", "status": "active"},
        {"id": "b2", "ats": "greenhouse", "slug": "fine", "company_name": "Fine Co", "status": "active"},
    ])
    monkeypatch.setattr(board_health, "db", fake_db)

    def _fake_poll(board):
        if board["slug"] == "broken":
            raise RuntimeError("network blew up")
        return {"http_status": 200, "posting_count": 3, "name_check_ok": True}

    monkeypatch.setattr(board_health, "poll_board", _fake_poll)

    counters = board_health.run_board_health_cycle()

    assert counters == {"polled": 2, "dead_flagged": 0, "relocation_proposed": 0, "errored": 1}
    assert len(fake_db.health_rows) == 1  # only the healthy board's row got recorded
