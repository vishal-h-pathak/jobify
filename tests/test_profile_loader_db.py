"""tests/test_profile_loader_db.py — H2's DB-backed profile_loader path.

`profile_loader.profile_dir()` grows a second resolution step:
`JOBIFY_PROFILE_USER_ID` materializes the `profiles.doc` JSONB row (the H1
contract) into a per-user cache dir and hands the existing dir-based loader
the result — no live DB in these tests, everything routes through a fake
Supabase client wired in via the shared `patch_db_client` fixture
(tests/conftest.py), which stubs `jobify.db`'s lazy `_client` cache without
tripping the module `__getattr__` -> `create_client()` hazard a plain
`monkeypatch.setattr(db, "client", fake)` would hit in secretless CI.
"""

from __future__ import annotations

import copy

import pytest

from jobify import profile_loader

_DOC = {
    "profile.yml": "identity:\n  name: Test User\n  email: test@example.com\n",
    "thesis.md": "# Hunting Thesis\n\nTest thesis body.\n",
    "voice-profile.md": "## Tone\nDirect.\n",
    "article-digest.md": "Do not invent facts.\n",
    "learned-insights.md": "",
    "cv.md": "# CV\n\nTest CV body.\n",
    "disqualifiers.yml": "hard_disqualifiers: []\nsoft_concerns: []\n",
    "portals.yml": "title_filter: {}\n",
}

_USER_ID = "11111111-1111-1111-1111-111111111111"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) == val]
        return self

    def execute(self):
        return _FakeResult(self._rows)


class _FakeClient:
    def __init__(self, rows):
        self.rows = rows
        self.fetch_count = 0

    def table(self, name):
        assert name == "profiles"
        self.fetch_count += 1
        return _FakeQuery(list(self.rows))


def _row(updated_at="2026-01-01T00:00:00Z", doc=None):
    return {
        "user_id": _USER_ID,
        "doc": doc if doc is not None else copy.deepcopy(_DOC),
        "compiled_rubric": None,
        "embedding": None,
        "updated_at": updated_at,
    }


@pytest.fixture(autouse=True)
def _isolate_env(tmp_path, monkeypatch):
    """Every test gets a private cache root and a clean loader cache, and
    neither env var lingers between tests."""
    monkeypatch.setenv("JOBIFY_PROFILE_CACHE", str(tmp_path / "cache"))
    monkeypatch.delenv("JOBIFY_PROFILE_DIR", raising=False)
    monkeypatch.delenv("JOBIFY_PROFILE_USER_ID", raising=False)
    profile_loader._clear_cache_for_tests()
    yield
    profile_loader._clear_cache_for_tests()


def test_materialize_writes_all_eight_files(patch_db_client):
    fake = _FakeClient([_row()])
    patch_db_client(fake)

    cache_dir = profile_loader._materialize_from_db(_USER_ID)

    assert cache_dir.is_dir()
    for name, content in _DOC.items():
        assert (cache_dir / name).read_text(encoding="utf-8") == content
    assert (cache_dir / profile_loader._STAMP_FILENAME).read_text(
        encoding="utf-8"
    ) == "2026-01-01T00:00:00Z"


def test_materialize_skips_rewrite_when_updated_at_unchanged(patch_db_client):
    fake = _FakeClient([_row(updated_at="2026-01-01T00:00:00Z")])
    patch_db_client(fake)
    profile_loader._materialize_from_db(_USER_ID)

    # Mutate the DB-side doc but keep the same updated_at — a real backend
    # wouldn't do this (updated_at tracks doc), but it isolates the staleness
    # check: same stamp must short-circuit before any file is rewritten.
    fake.rows[0]["doc"]["thesis.md"] = "MUTATED — should not land on disk"

    cache_dir = profile_loader._materialize_from_db(_USER_ID)
    assert (cache_dir / "thesis.md").read_text(encoding="utf-8") == _DOC["thesis.md"]


def test_materialize_rewrites_when_updated_at_newer(patch_db_client):
    fake = _FakeClient([_row(updated_at="2026-01-01T00:00:00Z")])
    patch_db_client(fake)
    profile_loader._materialize_from_db(_USER_ID)

    fake.rows[0]["updated_at"] = "2026-02-01T00:00:00Z"
    fake.rows[0]["doc"]["thesis.md"] = "# Updated Thesis\n"

    cache_dir = profile_loader._materialize_from_db(_USER_ID)
    assert (cache_dir / "thesis.md").read_text(encoding="utf-8") == "# Updated Thesis\n"
    assert (cache_dir / profile_loader._STAMP_FILENAME).read_text(
        encoding="utf-8"
    ) == "2026-02-01T00:00:00Z"


def test_materialize_ignores_older_updated_at(patch_db_client):
    fake = _FakeClient([_row(updated_at="2026-02-01T00:00:00Z")])
    patch_db_client(fake)
    profile_loader._materialize_from_db(_USER_ID)

    # Simulate a stale/rolled-back row with an OLDER updated_at than what's
    # already cached: must not regress the cache.
    fake.rows[0]["updated_at"] = "2026-01-01T00:00:00Z"
    fake.rows[0]["doc"]["thesis.md"] = "# Should not land\n"

    cache_dir = profile_loader._materialize_from_db(_USER_ID)
    assert (cache_dir / "thesis.md").read_text(encoding="utf-8") == _DOC["thesis.md"]


def test_materialize_raises_when_no_row(patch_db_client):
    fake = _FakeClient([])
    patch_db_client(fake)
    with pytest.raises(RuntimeError, match="no profiles row"):
        profile_loader._materialize_from_db(_USER_ID)


def test_profile_dir_user_id_path_end_to_end(monkeypatch, patch_db_client):
    """JOBIFY_PROFILE_USER_ID set → profile_dir() materializes and every
    public loader reads through it exactly like a dir-based profile would."""
    fake = _FakeClient([_row()])
    patch_db_client(fake)
    monkeypatch.setenv("JOBIFY_PROFILE_USER_ID", _USER_ID)

    resolved = profile_loader.profile_dir()
    assert resolved.is_dir()
    assert profile_loader.load_thesis() == _DOC["thesis.md"]
    assert profile_loader.load_cv() == _DOC["cv.md"]
    assert profile_loader.load_profile()["identity"]["name"] == "Test User"


def test_profile_dir_env_dir_wins_over_user_id(monkeypatch, tmp_path, patch_db_client):
    """JOBIFY_PROFILE_DIR still takes precedence — the DB path must never
    shadow an explicit directory override, and must not hit the DB at all."""
    explicit_dir = tmp_path / "explicit-profile"
    explicit_dir.mkdir()
    (explicit_dir / "thesis.md").write_text("explicit dir wins\n", encoding="utf-8")

    fake = _FakeClient([_row()])
    patch_db_client(fake)
    monkeypatch.setenv("JOBIFY_PROFILE_USER_ID", _USER_ID)
    monkeypatch.setenv("JOBIFY_PROFILE_DIR", str(explicit_dir))

    resolved = profile_loader.profile_dir()
    assert resolved == explicit_dir.resolve()
    assert fake.fetch_count == 0


def test_dir_based_resolution_unchanged(monkeypatch, tmp_path):
    """Regression guard for the exit criterion: cases 1/3/4 stay
    byte-identical to pre-H2 behavior (no DB touch, no cache-dir writes)."""
    explicit_dir = tmp_path / "some-profile"
    explicit_dir.mkdir()
    (explicit_dir / "cv.md").write_text("plain dir cv\n", encoding="utf-8")
    monkeypatch.setenv("JOBIFY_PROFILE_DIR", str(explicit_dir))

    assert profile_loader.profile_dir() == explicit_dir.resolve()
    assert profile_loader.load_cv() == "plain dir cv\n"


def test_materialized_profile_validation_failure_is_logged_not_raised(
    caplog, patch_db_client
):
    """An incomplete profiles.doc (e.g. missing profile.yml identity) must
    log a warning but still return a usable cache dir — the pipeline
    tables/loaders already degrade gracefully on missing files."""
    bad_doc = copy.deepcopy(_DOC)
    bad_doc["profile.yml"] = ""  # required file, blank -> validator ERROR
    fake = _FakeClient([_row(doc=bad_doc)])
    patch_db_client(fake)

    with caplog.at_level("WARNING", logger="jobify.profile_loader"):
        cache_dir = profile_loader._materialize_from_db(_USER_ID)

    assert cache_dir.is_dir()
    assert any("failed validation" in rec.message for rec in caplog.records)
