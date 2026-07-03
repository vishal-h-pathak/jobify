"""H3 exit criteria: a `profiles.doc` produced by the hosted onboarding
chat's doc builder (`web/lib/profile/buildDoc.ts`) must pass the
authoritative Python validator, not just its TS port.

`tests/fixtures/h3_profile_doc.json` is the real output of
`buildProfileDoc()` for a full mocked interview run (dumped once via
`npx tsx`, not hand-authored — see the H3 session prompt's exit criteria:
"dump the doc to a dir and run the real validator once in CI via a small
pytest"). This is the cross-language check that TS's `validateProfileDoc`
(exercised by `web/lib/profile/buildDoc.test.ts`) and the Python contract
(`onboarding/validate_profile.py`) agree on what "valid" means.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "h3_profile_doc.json"


def test_h3_generated_doc_passes_the_real_python_validator(tmp_path):
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
        f"validator rejected the H3-generated profiles.doc:\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
