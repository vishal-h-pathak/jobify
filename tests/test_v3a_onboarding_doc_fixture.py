"""V3A-1 exit criteria: a phase-1-only `profiles.doc` produced by
`buildMinimalDoc()` (`web/lib/onboarding/incrementalDoc.ts`) must pass the
authoritative Python validator, not just its TS port.

`tests/fixtures/v3a_minimal_profile_doc.json` is the real output of
`buildMinimalDoc()` for a fixed, mocked phase-1 interview (anchor +
reactions + values + dealbreakers only) — dumped via
`web/scripts/gen-v3a-fixture.ts`, not hand-authored. Mirrors
`test_h3_onboarding_doc_fixture.py` exactly: the cross-language check that
TS's `validateProfileDoc` and the Python contract
(`onboarding/validate_profile.py`) agree on what "valid" means, for the
doc the background-hunt checkpoint upserts *before* the rest of onboarding
has even happened.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "v3a_minimal_profile_doc.json"


def test_v3a_minimal_doc_passes_the_real_python_validator(tmp_path):
    doc = json.loads(_FIXTURE.read_text(encoding="utf-8"))

    target = tmp_path / "profile"
    target.mkdir()
    for filename, contents in doc.items():
        (target / filename).write_text(contents, encoding="utf-8")

    result = subprocess.run(
        [sys.executable, "onboarding/validate_profile.py", str(target)],
        cwd=_REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"validator rejected the V3A-1 minimal profiles.doc:\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
