"""The onboarding golden persona must stay loadable + contract-valid.

`onboarding/examples/profile/` is the worked output of the onboarding flow
(`onboarding/SKILL.md`) — a fictional frontend/design-systems engineer, Sam
Rivera. WS-A2 / WS-D / WS-F reuse it as a second persona fixture, so it has to
keep passing the exact contract the rest of the pipeline reads through
`jobify.profile_loader`.

Two angles, mirroring how the pipeline and the onboarding skill each consume it:

1. Loader round-trip — point `JOBIFY_PROFILE_DIR` at the example and assert the
   public loaders return the expected, well-formed values (the same calls
   hunt/tailor/submit make). No third-party deps.
2. Validator gate — run `onboarding/validate_profile.py` as a subprocess and
   assert exit 0 (the same gate the skill runs before declaring success). This
   exercises the JSON-schema check when `jsonschema` is installed and the
   required-key fallback otherwise.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent
_EXAMPLE_DIR = _REPO_ROOT / "onboarding" / "examples" / "profile"

# The seven application_defaults keys the submit pre-fill reads
# (jobify/submit/adapters/_common.py::applicant_fields). Pinned so dropping one
# from the example fails loudly.
_REQUIRED_DEFAULT_KEYS = {
    "work_authorization",
    "visa_sponsorship_needed",
    "earliest_start_date",
    "relocation_willingness",
    "in_person_willingness",
    "ai_policy_ack",
    "previous_interview_with_company",
}


@pytest.fixture
def _point_loader_at_example(monkeypatch: pytest.MonkeyPatch):
    """Resolve the loader to the golden example for the duration of a test."""
    from jobify import profile_loader

    monkeypatch.setenv("JOBIFY_PROFILE_DIR", str(_EXAMPLE_DIR))
    profile_loader._clear_cache_for_tests()
    yield profile_loader
    profile_loader._clear_cache_for_tests()


def test_example_dir_exists():
    assert _EXAMPLE_DIR.is_dir(), f"missing golden persona at {_EXAMPLE_DIR}"


def test_loader_round_trip(_point_loader_at_example):
    """Every public loader returns well-formed values for the golden persona."""
    pl = _point_loader_at_example
    assert pl.profile_dir() == _EXAMPLE_DIR

    profile = pl.load_profile()
    assert profile["identity"]["name"] == "Sam Rivera"
    assert "@example.com" in profile["identity"]["email"]  # obviously fictional

    defaults = pl.load_application_defaults()
    assert set(defaults) == _REQUIRED_DEFAULT_KEYS
    assert isinstance(defaults["previous_interview_with_company"], dict)
    assert isinstance(defaults["visa_sponsorship_needed"], bool)

    # archetypes parse and every lane has a label
    archetypes = pl.load_archetypes()
    assert archetypes, "expected at least one archetype lane"
    assert all("label" in v for v in archetypes.values())

    # voice profile splits into the expected sections
    voice = pl.load_voice_profile()
    assert voice["sections"], "voice-profile.md must yield >=1 '## ' section"

    # disqualifiers + portals shapes the scorer/hunter rely on
    disq = pl.load_disqualifiers()
    assert isinstance(disq.get("hard_disqualifiers"), list)
    assert isinstance(disq.get("soft_concerns"), list)

    portals = pl.load_portals()
    for required in ("greenhouse", "lever", "ashby", "workday", "title_filter"):
        assert required in portals
    tf = portals["title_filter"]
    for lst in ("reject_substrings", "prefer_substrings", "seniority_substrings"):
        assert tf[lst], f"title_filter.{lst} must be non-empty"


def test_anti_fabrication_fence_present(_point_loader_at_example):
    """article-digest.md must carry the do-not-invent guardrail."""
    digest = _point_loader_at_example.load_article_digest().lower()
    assert "do not invent" in digest or "do not have" in digest


def test_validate_profile_dir_does_not_touch_process_globals(monkeypatch, tmp_path):
    """H4: `validate_profile_dir()` is called once per user, in a loop, by
    the hosted fan-out worker's materialization step
    (`jobify.profile_loader._validate_materialized`). It must read the
    target directory through `profile_loader`'s dir-parameterized loaders
    only — never mutate `JOBIFY_PROFILE_DIR` or invalidate/populate
    `profile_dir()`'s process-global `lru_cache`, or two users validated
    back-to-back in one process could clobber each other."""
    from jobify import profile_loader
    from onboarding.validate_profile import validate_profile_dir

    # Prime the global cache with an unrelated dir, exactly like a
    # `jobify-hunt` single-user process would have already done.
    unrelated_dir = tmp_path / "unrelated"
    unrelated_dir.mkdir()
    monkeypatch.setenv("JOBIFY_PROFILE_DIR", str(unrelated_dir))
    profile_loader._clear_cache_for_tests()
    try:
        assert profile_loader.profile_dir() == unrelated_dir.resolve()

        env_before = dict(os.environ)
        rep = validate_profile_dir(_EXAMPLE_DIR)
        assert rep.passed

        # Untouched: same env vars, same resolved global dir.
        assert dict(os.environ) == env_before
        assert profile_loader.profile_dir() == unrelated_dir.resolve()
    finally:
        profile_loader._clear_cache_for_tests()


def test_validator_passes_on_example():
    """`onboarding/validate_profile.py` exits 0 on the golden persona."""
    result = subprocess.run(
        [sys.executable, "onboarding/validate_profile.py", str(_EXAMPLE_DIR)],
        cwd=_REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"validator failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
