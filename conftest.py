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
"""

import sys
from pathlib import Path

_REPO_ROOT = str(Path(__file__).resolve().parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
