"""tests/test_hosted_worker.py — jobify.hosted.worker (H4 Task 4; HNT-1).

The console-script entry point composes Task 2's `run_discovery_cycle()`
and Task 3's `run_fanout_cycle()` — this file fakes both (no real
discovery/fan-out execution; that's already covered by
`tests/test_hosted_discovery.py` / `tests/test_hosted_fanout.py`) and
asserts:

  1. Call order: discovery runs THEN fan-out.
  2. The combined summary (both the returned dict and the printed
     terminal line) reflects both cycles' own summary fields.
  3. Failure isolation: a whole-phase discovery failure propagates and
     aborts the cycle — fan-out never runs against a stale/partial
     `postings` pool. See `jobify/hosted/worker.py`'s module docstring
     for the documented rationale (mirrors `jobify.hunt.agent`'s own
     posture: per-item resilience inside a phase, no swallowing of a
     whole-phase failure).
  4. `run()` (the actual console-script target) parses `--once` and
     drives `_execute()` exactly once.
  5. HNT-1: `--discovery-only` never calls fan-out; `--user <uuid>`
     scores exactly that one user; the two flags are mutually
     exclusive.
"""

from __future__ import annotations

import pytest

from jobify.hosted import worker

_DISCOVERY_SUMMARY = {
    "users": 2,
    "boards": {"greenhouse": 1, "lever": 0, "ashby": 0, "workday": 0},
    "fetched": 5,
    "upserted": 4,
    "dead": 1,
}

_FANOUT_SUMMARY = {
    "users_processed": 2,
    "users_skipped_invalid": 0,
    "users_errored": 0,
    "postings_scored": 5,
    "matches_written": 3,
    "stage4_calls": 1,
    "users_budget_stopped": 0,
}


def test_execute_calls_discovery_then_fanout(monkeypatch, capsys):
    calls: list[str] = []

    def fake_discovery():
        calls.append("discovery")
        return dict(_DISCOVERY_SUMMARY)

    def fake_fanout(user_ids=None):
        calls.append("fanout")
        assert user_ids is None  # _execute() calls the default (all users), not a subset
        return dict(_FANOUT_SUMMARY)

    monkeypatch.setattr(worker.discovery, "run_discovery_cycle", fake_discovery)
    monkeypatch.setattr(worker.fanout, "run_fanout_cycle", fake_fanout)
    monkeypatch.setattr(worker.db, "get_global_month_to_date_spend", lambda: 12.34)
    monkeypatch.setattr(worker.config, "HOSTED_GLOBAL_MONTHLY_CAP_USD", 100.0)
    ntfy_calls: list[str] = []
    monkeypatch.setattr(
        worker, "send_ntfy_summary", lambda line: ntfy_calls.append(line) or False
    )

    result = worker._execute()

    assert calls == ["discovery", "fanout"]
    assert result == {"discovery": _DISCOVERY_SUMMARY, "fanout": _FANOUT_SUMMARY}

    printed = capsys.readouterr().out
    # The printed summary line names the fields discovery/fanout already
    # return — not new bookkeeping invented in this module.
    assert "fetched=5" in printed
    assert "upserted=4" in printed
    assert "dead=1" in printed
    assert "processed=2" in printed
    assert "matches_written=3" in printed
    assert "stage4_calls=1" in printed
    assert "budget_stopped=0" in printed
    assert "pool_spend=$12.34/$100.00" in printed

    # ntfy is called with the full summary line (H7), and logs/print fire
    # regardless of what send_ntfy_summary returns (mocked to False here).
    assert len(ntfy_calls) == 1
    assert "pool_spend=$12.34/$100.00" in ntfy_calls[0]


def test_execute_aborts_cycle_when_discovery_raises(monkeypatch):
    """Documented failure-isolation policy: a whole-phase discovery
    failure is NOT caught here — it propagates, and fan-out does not
    run this cycle. (Per-source resilience inside discovery, and
    per-user resilience inside fan-out, are Task 2/3's own job and are
    untouched by this policy.)
    """
    fanout_calls: list[str] = []

    def fake_discovery():
        raise RuntimeError("discovery phase blew up")

    def fake_fanout(user_ids=None):
        fanout_calls.append("fanout")
        return dict(_FANOUT_SUMMARY)

    monkeypatch.setattr(worker.discovery, "run_discovery_cycle", fake_discovery)
    monkeypatch.setattr(worker.fanout, "run_fanout_cycle", fake_fanout)

    with pytest.raises(RuntimeError, match="discovery phase blew up"):
        worker._execute()

    assert fanout_calls == []


def test_run_parses_once_flag_and_executes_one_cycle(monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(
        worker, "_execute", lambda **kwargs: calls.append(kwargs) or {}
    )
    monkeypatch.setattr("sys.argv", ["jobify-hosted-hunt", "--once"])

    worker.run()

    assert calls == [{"discovery_only": False, "user_id": None}]


def test_execute_discovery_only_never_calls_fanout(monkeypatch, capsys):
    fanout_calls: list[str] = []

    monkeypatch.setattr(
        worker.discovery, "run_discovery_cycle", lambda: dict(_DISCOVERY_SUMMARY)
    )
    monkeypatch.setattr(
        worker.fanout,
        "run_fanout_cycle",
        lambda user_ids=None: fanout_calls.append("fanout") or dict(_FANOUT_SUMMARY),
    )
    monkeypatch.setattr(worker.db, "get_global_month_to_date_spend", lambda: 0.0)
    monkeypatch.setattr(worker.config, "HOSTED_GLOBAL_MONTHLY_CAP_USD", 100.0)
    monkeypatch.setattr(worker, "send_ntfy_summary", lambda line: False)

    result = worker._execute(discovery_only=True)

    assert fanout_calls == []
    assert result["fanout"]["users_processed"] == 0
    assert result["fanout"]["matches_written"] == 0

    printed = capsys.readouterr().out
    assert "mode=discovery_only" in printed
    assert "processed=0" in printed


def test_execute_with_user_id_scores_exactly_one_user(monkeypatch):
    seen_user_ids: list = []

    monkeypatch.setattr(
        worker.discovery, "run_discovery_cycle", lambda: dict(_DISCOVERY_SUMMARY)
    )

    def fake_fanout(user_ids=None):
        seen_user_ids.append(user_ids)
        return dict(_FANOUT_SUMMARY)

    monkeypatch.setattr(worker.fanout, "run_fanout_cycle", fake_fanout)
    monkeypatch.setattr(worker.db, "get_global_month_to_date_spend", lambda: 0.0)
    monkeypatch.setattr(worker.config, "HOSTED_GLOBAL_MONTHLY_CAP_USD", 100.0)
    monkeypatch.setattr(worker, "send_ntfy_summary", lambda line: False)

    worker._execute(user_id="user-abc")

    assert seen_user_ids == [["user-abc"]]


def test_run_parses_discovery_only_flag(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(
        worker, "_execute", lambda **kwargs: calls.append(kwargs) or {}
    )
    monkeypatch.setattr("sys.argv", ["jobify-hosted-hunt", "--discovery-only"])

    worker.run()

    assert calls == [{"discovery_only": True, "user_id": None}]


def test_run_parses_user_flag(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(
        worker, "_execute", lambda **kwargs: calls.append(kwargs) or {}
    )
    monkeypatch.setattr("sys.argv", ["jobify-hosted-hunt", "--user", "user-abc"])

    worker.run()

    assert calls == [{"discovery_only": False, "user_id": "user-abc"}]


def test_run_rejects_discovery_only_and_user_together(monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.argv", ["jobify-hosted-hunt", "--discovery-only", "--user", "user-abc"]
    )

    with pytest.raises(SystemExit):
        worker.run()

    assert "mutually exclusive" in capsys.readouterr().err
