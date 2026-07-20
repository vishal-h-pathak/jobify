"""HUNT2 P0.5 match-status contract — the hosted aggregator's
matches.status enum cannot drift silently, mirroring
tests/test_match_state_contract.py's approach for matches.state.

Two invariants:

1. ``jobify/shared/match_status.json`` matches ``CANONICAL_MATCH_STATUSES``
   in ``jobify/shared/match_status.py``. If you edit the tuple, re-run
   ``python -m jobify.shared.match_status`` and commit the JSON.
2. The ``matches_status_check`` CHECK constraint in
   ``jobify/migrations/0014_hunt2_funnel.sql`` lists exactly the
   canonical enum.

Separate contract from matches.state (tests/test_match_state_contract.py)
and jobs.status (tests/test_status_contract.py).
"""

from __future__ import annotations

import json
from pathlib import Path

from jobify.shared.match_status import (
    CANONICAL_MATCH_STATUSES,
    MATCH_STATUS_JSON_PATH,
    match_status_json_payload,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
JOBIFY_DIR = REPO_ROOT / "jobify"


def test_match_status_json_matches_python_definition():
    on_disk = json.loads(MATCH_STATUS_JSON_PATH.read_text(encoding="utf-8"))
    assert on_disk == match_status_json_payload(), (
        "jobify/shared/match_status.json is stale — regenerate with "
        "`python -m jobify.shared.match_status` and commit it"
    )


def test_migration_check_constraint_lists_exactly_the_canonical_enum():
    """0014_hunt2_funnel.sql carries the canonical matches_status_check.
    Its quoted-status list must equal CANONICAL_MATCH_STATUSES."""
    sql = (JOBIFY_DIR / "migrations" / "0014_hunt2_funnel.sql").read_text(encoding="utf-8")
    constraint = sql.split("ADD CONSTRAINT matches_status_check")[1].split(";")[0]
    in_constraint = {
        line.strip().strip(",").strip("'")
        for line in constraint.splitlines()
        if line.strip().startswith("'")
    }
    assert in_constraint == set(CANONICAL_MATCH_STATUSES), (
        "jobify/migrations/0014_hunt2_funnel.sql matches_status_check drifted "
        "from CANONICAL_MATCH_STATUSES"
    )
