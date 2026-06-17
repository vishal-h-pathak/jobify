"""Pin the shape and values of `application_defaults` against drift.

Three angles:

1. Shipped example profile (`profile.example/profile.yml`):
   `load_application_defaults()` must equal the frozen expected dict. If
   anyone edits the example YAML in a way that changes a form-default
   value, this fails and forces an explicit decision. (WS-A2: this no
   longer pins a real person's defaults — the shipped baseline is the
   neutral example persona.)

2. `tmp_profile` fixture:
   The same loader, pointed at a fresh fixture dir via
   `JOBIFY_PROFILE_DIR`, must produce the same dict. The fixture's
   `application_defaults` are kept identical to the example's, so this
   catches loader bugs that only surface under env-var override.

3. Loader output keys must match the canonical field set:
   the test pins the field set so silent additions/removals require an
   intentional update to both this test and the YAML.
"""

from __future__ import annotations


# The application_defaults block of the shipped example persona
# (`profile.example/profile.yml`) and the test fixture
# (`tests/fixtures/profile/profile.yml`), kept identical. Update this
# alongside both YAMLs when a form-default value genuinely changes; the
# test failing is the prompt to re-confirm the change is intentional.
EXPECTED_APPLICATION_DEFAULTS = {
    "work_authorization": "us_citizen",
    "visa_sponsorship_needed": False,
    "earliest_start_date": (
        "as early as possible; typical notice is two weeks after offer acceptance"
    ),
    "relocation_willingness": (
        "based in Denver, CO; open to relocation for the right role and "
        "compensation, otherwise prefers remote or local"
    ),
    "in_person_willingness": (
        "remote or hybrid preferred; open to occasional travel"
    ),
    "ai_policy_ack": (
        "I use AI tools to accelerate drafting, research, and exploration, but I\n"
        "keep a human in the loop: I review, validate, and take responsibility\n"
        "for all work I produce.\n"
    ),
    "previous_interview_with_company": {},
}


def test_example_profile_application_defaults_matches_expected(monkeypatch):
    """The shipped `profile.example/profile.yml` matches the frozen dict."""
    from pathlib import Path

    from jobify import profile_loader

    example_dir = Path(__file__).resolve().parent.parent / "profile.example"
    monkeypatch.setenv("JOBIFY_PROFILE_DIR", str(example_dir))
    profile_loader._clear_cache_for_tests()
    try:
        actual = profile_loader.load_application_defaults()
        assert actual == EXPECTED_APPLICATION_DEFAULTS
    finally:
        profile_loader._clear_cache_for_tests()


def test_tmp_profile_loader_roundtrip(tmp_profile):
    """Loader honors `JOBIFY_PROFILE_DIR` and parses fixture YAML."""
    from jobify import profile_loader

    fixture_dir = tmp_profile()
    assert profile_loader.profile_dir() == fixture_dir
    assert profile_loader.load_application_defaults() == EXPECTED_APPLICATION_DEFAULTS
    voice = profile_loader.load_voice_profile()
    assert "raw" in voice
    assert "sections" in voice
    assert "how-he-communicates" in voice["sections"]


def test_loader_keys_match_smoke_greenhouse_contract(tmp_profile):
    """Loader output keys equal the smoke contract — no silent adds/removes.

    `FAKE_APPLICANT` is `{**identity_stubs, **load_application_defaults()}`,
    so the form-default keys must be exactly `EXPECTED_APPLICATION_DEFAULTS`.
    Either side gaining or losing a key without the other catches here.
    """
    tmp_profile()
    from jobify import profile_loader

    defaults = profile_loader.load_application_defaults()
    assert set(defaults.keys()) == set(EXPECTED_APPLICATION_DEFAULTS.keys())
