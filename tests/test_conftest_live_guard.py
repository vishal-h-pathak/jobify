"""tests/test_conftest_live_guard.py — HUNT2 P3 S6 live-write guard.

Root conftest.py patches `supabase.create_client` so every call during a
pytest session — whether through `jobify.db._get_client()`'s lazy import
or a direct `from supabase import create_client` — refuses to construct a
client against a non-local URL unless `JOBIFY_TEST_ALLOW_LIVE=1`. This is
the structural backstop for the live incident (synthetic `hunt_cycles`
rows landing in production because a test was missing a `jobify.db`
mock) — these tests exercise the guard itself, not any one call site.
"""

from __future__ import annotations

import supabase


def test_guard_blocks_a_real_looking_project_url():
    try:
        supabase.create_client("https://realproject.supabase.co", "service-role-key")
        assert False, "expected the guard to raise"
    except RuntimeError as exc:
        assert "refusing to construct a real Supabase client" in str(exc)


def test_guard_allows_local_supabase_stack():
    client = supabase.create_client("http://127.0.0.1:54321", "local-anon-key")
    assert client is not None


def test_guard_allows_empty_url():
    # No URL to protect — supabase-py's own construction is left to fail
    # (or not) on its own terms; this guard only concerns itself with a
    # real, non-local project URL.
    try:
        supabase.create_client("", "some-key")
    except RuntimeError as exc:
        assert "refusing to construct" not in str(exc)
    except Exception:
        pass  # supabase-py's own validation error is not this guard's concern


def test_guard_respects_allow_live_override(monkeypatch):
    monkeypatch.setenv("JOBIFY_TEST_ALLOW_LIVE", "1")
    client = supabase.create_client("https://realproject.supabase.co", "service-role-key")
    assert client is not None
