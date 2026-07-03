"""tests/test_portals_fanout.py — H4 fan-out fix for `_portals.py`.

`_PORTALS_CACHE` is a process-global singleton keyed to whichever profile
`_load_portals()` first resolved — the same class of bug `profile_dir()`
had (see `tests/test_profile_loader_db.py`'s fan-out isolation tests).
These tests pin the explicit-`profile_dir` escape hatch a fan-out worker
uses to read many users' `portals.yml` in one process without one user's
title-filter config leaking into (or being leaked into by) another's.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from jobify.hunt.sources import _portals


@pytest.fixture(autouse=True)
def _isolate_global_cache():
    """Save/restore the module-global cache so mutating it here (to prove
    explicit-dir calls don't touch it) never leaks into other test files
    (e.g. `tests/test_portals_config.py`, which relies on the cache
    resolving the shipped/active `portals.yml`)."""
    original = _portals._PORTALS_CACHE
    yield
    _portals._PORTALS_CACHE = original


def _write_portals(tmp_path: Path, name: str, reject_substring: str) -> Path:
    d = tmp_path / name
    d.mkdir()
    (d / "portals.yml").write_text(
        "greenhouse:\n  companies: []\n"
        "title_filter:\n"
        f"  reject_substrings:\n    - {reject_substring}\n"
        "  prefer_substrings: []\n"
        "  seniority_substrings: []\n",
        encoding="utf-8",
    )
    return d


def test_explicit_profile_dir_isolated_across_two_users(tmp_path):
    """Two users' portals.yml, both read with an explicit `profile_dir` in
    the same process, must never cross-contaminate."""
    dir_a = _write_portals(tmp_path, "user-a", "reject-a")
    dir_b = _write_portals(tmp_path, "user-b", "reject-b")

    assert _portals.passes_title_filter("has reject-a", dir_a) is False
    assert _portals.passes_title_filter("has reject-b", dir_a) is True
    assert _portals.passes_title_filter("has reject-b", dir_b) is False
    assert _portals.passes_title_filter("has reject-a", dir_b) is True


def test_explicit_profile_dir_never_populates_the_global_cache(tmp_path):
    _portals._PORTALS_CACHE = {"title_filter": {"reject_substrings": ["sentinel"]}}
    dir_a = _write_portals(tmp_path, "user-a", "reject-a")

    _portals.passes_title_filter("has reject-a", dir_a)

    # The global cache — what the zero-arg, single-user `jobify-hunt` path
    # reads — must be exactly what it was before the explicit-dir call.
    assert _portals._PORTALS_CACHE == {"title_filter": {"reject_substrings": ["sentinel"]}}


def test_explicit_profile_dir_never_reads_the_global_cache(tmp_path, monkeypatch):
    """A populated global cache must not leak into an explicit-dir call —
    only that dir's own portals.yml governs the filter."""
    _portals._PORTALS_CACHE = {"title_filter": {"reject_substrings": ["global-only-reject"]}}
    dir_a = _write_portals(tmp_path, "user-a", "reject-a")

    # If the explicit-dir path fell through to the global cache, this
    # would be rejected (it contains "global-only-reject" is False here,
    # so instead assert the dir's OWN term is what's enforced).
    assert _portals.passes_title_filter("has reject-a", dir_a) is False
    assert _portals.passes_title_filter("has global-only-reject", dir_a) is True


def test_zero_arg_path_still_uses_and_populates_global_cache(monkeypatch):
    """The single-user `jobify-hunt` call sites (no `profile_dir` arg)
    must behave exactly as before H4: first call populates
    `_PORTALS_CACHE`, subsequent calls reuse it without re-loading."""
    _portals._PORTALS_CACHE = None
    calls: list[object] = []

    def fake_load_portals(profile_dir=None):
        calls.append(profile_dir)
        return {"title_filter": {"reject_substrings": ["zero-arg-reject"]}}

    monkeypatch.setattr(_portals.profile_loader, "load_portals", fake_load_portals)

    assert _portals.passes_title_filter("has zero-arg-reject") is False
    assert calls == [None]
    assert _portals._PORTALS_CACHE == {
        "title_filter": {"reject_substrings": ["zero-arg-reject"]}
    }

    # Second zero-arg call reuses the cache — no second load.
    assert _portals.passes_title_filter("clean title") is True
    assert calls == [None]


def test_companies_and_workday_tenants_accept_explicit_profile_dir(tmp_path):
    d = tmp_path / "user-c"
    d.mkdir()
    (d / "portals.yml").write_text(
        "greenhouse:\n"
        "  companies:\n"
        "    - slug: acme\n"
        "      name: Acme Corp\n"
        "workday:\n"
        "  companies:\n"
        "    - tenant: acme\n"
        "      site: careers\n"
        "      dc: 1\n"
        "      name: Acme Corp\n",
        encoding="utf-8",
    )

    assert _portals.companies("greenhouse", d) == [("acme", "Acme Corp")]
    assert _portals.workday_tenants(d) == [
        {"tenant": "acme", "site": "careers", "dc": 1, "name": "Acme Corp"}
    ]
