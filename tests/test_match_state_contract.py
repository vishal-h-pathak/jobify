"""H1 match-state contract — the hosted aggregator's matches.state enum
cannot drift silently, mirroring tests/test_status_contract.py's approach
for jobs.status.

Two invariants (a third — "every db.py transition emits only canonical
states" — doesn't apply yet: no db.py helpers write matches.state in this
session; H2/H4 add those and can extend this test then):

1. ``jobify/shared/match_state.json`` matches ``CANONICAL_MATCH_STATES``
   in ``jobify/shared/match_state.py``. If you edit the tuple, re-run
   ``python -m jobify.shared.match_state`` and commit the JSON.
2. The ``matches_state_check`` CHECK constraint in
   ``jobify/migrations/0002_multitenant.sql`` lists exactly the
   canonical enum.

This is a separate contract from jobs.status — tests/test_status_contract.py
and jobify/shared/status.py are untouched by H1.
"""

from __future__ import annotations

import json
from pathlib import Path

from jobify.shared.match_state import (
    CANONICAL_MATCH_STATES,
    MATCH_STATE_JSON_PATH,
    match_state_json_payload,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
JOBIFY_DIR = REPO_ROOT / "jobify"


def test_match_state_json_matches_python_definition():
    on_disk = json.loads(MATCH_STATE_JSON_PATH.read_text(encoding="utf-8"))
    assert on_disk == match_state_json_payload(), (
        "jobify/shared/match_state.json is stale — regenerate with "
        "`python -m jobify.shared.match_state` and commit it"
    )


def test_migration_check_constraint_lists_exactly_the_canonical_enum():
    """0002_multitenant.sql carries the canonical matches_state_check.
    Its quoted-state list must equal CANONICAL_MATCH_STATES — the third
    leg of the contract."""
    sql = (JOBIFY_DIR / "migrations" / "0002_multitenant.sql").read_text(encoding="utf-8")
    constraint = sql.split("ADD CONSTRAINT matches_state_check")[1].split(";")[0]
    in_constraint = {
        line.strip().strip(",").strip("'")
        for line in constraint.splitlines()
        if line.strip().startswith("'")
    }
    assert in_constraint == set(CANONICAL_MATCH_STATES), (
        "jobify/migrations/0002_multitenant.sql matches_state_check drifted "
        "from CANONICAL_MATCH_STATES"
    )
