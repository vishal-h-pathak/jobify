"""tests/test_hunt_query_templates.py — sources.query_templates (P0.6,
HUNT2 session 47). Replaces the old hardcoded SerpAPI/JSearch query lists
with per-user template expansion: top ~3 target titles from the profile's
targeting tiers, times remote-acceptability and/or base metro.
"""

from __future__ import annotations

from jobify.hunt.sources.query_templates import build_queries_for_profile, union_queries


def _profile(*, titles, remote_acceptable=False, base=""):
    tiers = {
        f"tier_{i + 1}": {"label": title}
        for i, title in enumerate(titles)
    }
    return {
        "what_he_is_looking_for": tiers,
        "location_and_compensation": {
            "remote_acceptable": remote_acceptable,
            "base": base,
        },
    }


def test_remote_acceptable_and_base_both_expand_the_title():
    profile = _profile(titles=["Platform Engineer"], remote_acceptable=True, base="Denver, CO")
    queries = build_queries_for_profile(profile)
    assert queries == ["Platform Engineer remote", "Platform Engineer Denver, CO"]


def test_remote_only_when_base_unset():
    profile = _profile(titles=["Platform Engineer"], remote_acceptable=True, base="")
    assert build_queries_for_profile(profile) == ["Platform Engineer remote"]


def test_base_only_when_not_remote_acceptable():
    profile = _profile(titles=["Platform Engineer"], remote_acceptable=False, base="Denver, CO")
    assert build_queries_for_profile(profile) == ["Platform Engineer Denver, CO"]


def test_bare_title_when_neither_remote_nor_base_stated():
    profile = _profile(titles=["Platform Engineer"], remote_acceptable=False, base="")
    assert build_queries_for_profile(profile) == ["Platform Engineer"]


def test_only_top_three_tiers_contribute_titles():
    profile = _profile(
        titles=["Tier One", "Tier Two", "Tier Three", "Tier Four"],
        remote_acceptable=True,
    )
    queries = build_queries_for_profile(profile)
    assert queries == [
        "Tier One remote", "Tier Two remote", "Tier Three remote",
    ]


def test_two_users_with_different_titles_and_locations_generate_different_query_sets():
    """P0.6 acceptance test."""
    user_a = _profile(titles=["Platform Engineer"], remote_acceptable=True, base="Denver, CO")
    user_b = _profile(titles=["Product Designer"], remote_acceptable=False, base="Austin, TX")
    assert build_queries_for_profile(user_a) != build_queries_for_profile(user_b)


def test_owner_like_fixture_no_longer_emits_atlanta_unless_profile_says_so():
    """P0.6 acceptance test: the retired hardcoded query strings baked in
    "Atlanta" for every user regardless of their actual profile. A
    profile that doesn't mention Atlanta must never produce an Atlanta
    query; one whose stated base metro IS Atlanta legitimately does."""
    denver_user = _profile(titles=["Platform Engineer"], remote_acceptable=True, base="Denver, CO")
    assert not any("atlanta" in q.lower() for q in build_queries_for_profile(denver_user))

    atlanta_user = _profile(titles=["Platform Engineer"], remote_acceptable=True, base="Atlanta, GA")
    assert any("atlanta" in q.lower() for q in build_queries_for_profile(atlanta_user))


def test_union_queries_dedups_across_users_case_insensitively():
    user_a = _profile(titles=["Platform Engineer"], remote_acceptable=True)
    user_b = _profile(titles=["platform engineer"], remote_acceptable=True)
    queries = union_queries([user_a, user_b], cap=12)
    assert queries == ["Platform Engineer remote"]


def test_union_queries_caps_and_logs_drops(caplog):
    profiles = [
        _profile(titles=[f"Title {i}"], remote_acceptable=True) for i in range(20)
    ]
    with caplog.at_level("INFO", logger="sources.query_templates"):
        queries = union_queries(profiles, cap=12, provider="jsearch")
    assert len(queries) == 12
    assert any("dropped" in rec.message and "jsearch" in rec.message for rec in caplog.records)


def test_union_queries_empty_profiles_yields_empty_list():
    assert union_queries([], cap=12) == []
