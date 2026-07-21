"""Repo-root conftest — make the un-packaged `onboarding/` dir importable.

`onboarding/` is deliberately not part of the installed `jobify` distribution
(it's the interview skill + schemas a human runs from a checkout), but
`jobify.profile_loader._validate_materialized` and several tests import
`onboarding.validate_profile`. That import only works when the repo root is
on sys.path — true under `python -m pytest` (CWD insertion) but NOT under a
bare `pytest` binary, which is exactly how CI runs and why three tests failed
there while passing locally (found 2026-07-04).

This conftest pins the repo root onto sys.path for every pytest run,
regardless of invocation style. The production worker gets the same guarantee
from `PYTHONPATH` in `.github/workflows/hosted-hunt.yml`.

Proper fix (parked follow-up): move the validator core into the `jobify`
package with the schemas as package data, leaving `onboarding/validate_profile.py`
as a thin CLI wrapper — then delete this file and the workflow PYTHONPATH line.

---

HUNT2 P3 S6 test-isolation guard (live incident, cycle 51-ish: synthetic
`hunt_cycles` rows 48-50 landed in the PRODUCTION Supabase project during
a local `pytest` run with `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
exported in the shell environment). Root cause: several
`tests/test_hosted_worker.py` tests drive `jobify.hosted.worker._execute()`
end-to-end but only mock the discovery/fanout/candidates phases, not
`jobify.db.insert_hunt_cycle_row` — `_execute()`'s `finally` block writes
that row unconditionally on every cycle, mocked or not, so an
under-mocked test with real credentials in the environment silently
writes to whatever project those credentials point at. Fixed at the
test-file level (those tests now mock `insert_hunt_cycle_row` too), but a
missing mock is exactly the kind of thing that's easy to reintroduce —
this module adds a second, structural line of defense: `jobify.db`'s
`_get_client()` / `_get_service_client()` both lazily do
`from supabase import create_client` and call it with `SUPABASE_URL`;
patching the `supabase.create_client` module attribute here, before any
test module is ever collected, means EVERY such call during a pytest
session goes through the guard below, not just the ones this session
happened to find and fix.

The guard refuses to construct a client against a non-local URL unless
`JOBIFY_TEST_ALLOW_LIVE=1` is explicitly set (this applies even to
`tests/test_rls_multitenant.py`'s `-m integration` suite, which imports
`create_client` directly from `supabase` at module level rather than
through `jobify.db` — that import happens AFTER this file has already
patched the module attribute, since conftest.py loads before any test
module is collected). A missing/empty `SUPABASE_URL` still passes
through unguarded — there's no real project to protect there, and
`supabase-py`'s own client construction already fails loudly on an
invalid URL, a pre-existing failure mode this guard doesn't need to
duplicate.
"""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

_REPO_ROOT = str(Path(__file__).resolve().parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


def _is_local_supabase_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local")


try:
    import supabase as _supabase_pkg
except ImportError:
    _supabase_pkg = None

if _supabase_pkg is not None:
    _real_create_client = _supabase_pkg.create_client

    def _guarded_create_client(supabase_url: str = "", supabase_key: str = "", *args, **kwargs):
        if (
            os.environ.get("JOBIFY_TEST_ALLOW_LIVE") == "1"
            or not supabase_url
            or _is_local_supabase_url(supabase_url)
        ):
            return _real_create_client(supabase_url, supabase_key, *args, **kwargs)
        raise RuntimeError(
            f"jobify test-isolation guard: refusing to construct a real Supabase "
            f"client against {supabase_url!r} during a pytest run. This test is "
            "missing a jobify.db mock (see tests/conftest.py's `patch_db_client` "
            "fixture, or monkeypatch the specific jobify.db.* function this code "
            "path calls) — a live incident (synthetic hunt_cycles rows landing in "
            "production) happened exactly this way. Set JOBIFY_TEST_ALLOW_LIVE=1 "
            "to intentionally allow a real write (e.g. the `-m integration` suite "
            "against a deliberately-provisioned project)."
        )

    _supabase_pkg.create_client = _guarded_create_client
