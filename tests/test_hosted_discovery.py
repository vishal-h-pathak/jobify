"""tests/test_hosted_discovery.py — jobify.hosted.discovery (H4 Task 2).

Global discovery unions every user's `portals.yml` boards, fetches each
real posting exactly once via the existing `jobify.hunt.sources`
fetchers, resolves links via the real `jobify.hunt.agent._resolve_link_and_liveness`
(direct ATS URLs short-circuit with zero HTTP — see
`tests/test_hunt_direct_listings.py`), and upserts into the shared
`postings` pool. Everything here fakes the source-fetcher layer and the
DB layer — no network, no live Supabase, matching this repo's existing
hunt-test conventions (`tests/test_hunt_backfill_links.py`).
"""

from __future__ import annotations

import pytest

from jobify import db
from jobify.hosted import discovery
from sources import (
    ashby,
    eighty_thousand_hours,
    greenhouse,
    hn_whoshiring,
    jsearch,
    lever,
    remoteok,
    serpapi,
    workday,
)
from sources import _portals

GH_URL = "https://boards.greenhouse.io/acmeco/jobs/1"
LEVER_URL = "https://jobs.lever.co/acmeco/2"


def _gh_job(slug: str, jid: str = "gh-1"):
    return {
        "id": jid,
        "source": "greenhouse",
        "title": "Platform Engineer",
        "company": "Acme Co",
        "location": "Remote",
        "description": "x" * 200,
        "url": GH_URL,
    }


@pytest.fixture(autouse=True)
def _no_op_other_sources(monkeypatch):
    """Only Greenhouse is exercised by default in most tests below; keep
    Lever/Ashby/Workday and the five fixed keyword-search sources silent
    so the union-dedup assertions aren't muddied by unrelated fetch calls
    (and so no test hits the network now that `_iter_union_postings`
    calls all nine sources unconditionally)."""
    monkeypatch.setattr(lever, "fetch", lambda targets=None, apply_title_filter=True: iter(()))
    monkeypatch.setattr(ashby, "fetch", lambda targets=None, apply_title_filter=True: iter(()))
    monkeypatch.setattr(workday, "fetch", lambda tenants=None, apply_title_filter=True: iter(()))
    monkeypatch.setattr(hn_whoshiring, "fetch", lambda: iter(()))
    monkeypatch.setattr(eighty_thousand_hours, "fetch", lambda: iter(()))
    monkeypatch.setattr(remoteok, "fetch", lambda: iter(()))
    monkeypatch.setattr(jsearch, "fetch", lambda: iter(()))
    monkeypatch.setattr(serpapi, "fetch", lambda: iter(()))


# ── _union_portal_targets ─────────────────────────────────────────────────


def _portals_dir(tmp_path, name: str, yaml_text: str):
    d = tmp_path / name
    d.mkdir()
    (d / "portals.yml").write_text(yaml_text, encoding="utf-8")
    return d


def test_union_dedups_greenhouse_by_slug(tmp_path, monkeypatch):
    dir_a = _portals_dir(tmp_path, "user-a", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Co
""")
    dir_b = _portals_dir(tmp_path, "user-b", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Company (dup label)
    - slug: beta
      name: Beta Inc
""")
    monkeypatch.setattr(
        discovery, "materialize_profile_dir",
        lambda user_id: {"user-a": dir_a, "user-b": dir_b}[user_id],
    )

    union = discovery._union_portal_targets(["user-a", "user-b"])

    assert union["greenhouse"] == [("acmeco", "Acme Co"), ("beta", "Beta Inc")]
    assert union["lever"] == []
    assert union["ashby"] == []
    assert union["workday"] == []


def test_union_dedups_workday_by_tenant_site_dc(tmp_path, monkeypatch):
    dir_a = _portals_dir(tmp_path, "user-a", """
workday:
  companies:
    - tenant: acme
      site: External
      dc: wd1
      name: Acme
      limit_pages: 1
""")
    dir_b = _portals_dir(tmp_path, "user-b", """
workday:
  companies:
    - tenant: acme
      site: External
      dc: wd1
      name: Acme (different label)
      limit_pages: 5
""")
    monkeypatch.setattr(
        discovery, "materialize_profile_dir",
        lambda user_id: {"user-a": dir_a, "user-b": dir_b}[user_id],
    )

    union = discovery._union_portal_targets(["user-a", "user-b"])

    assert len(union["workday"]) == 1
    assert union["workday"][0]["name"] == "Acme"
    assert union["workday"][0]["limit_pages"] == 1


def test_union_skips_user_whose_profile_fails_to_materialize(tmp_path, monkeypatch, caplog):
    dir_b = _portals_dir(tmp_path, "user-b", """
greenhouse:
  companies:
    - slug: beta
      name: Beta Inc
""")

    def _fake_materialize(user_id):
        if user_id == "user-a":
            raise RuntimeError("no profiles row")
        return dir_b

    monkeypatch.setattr(discovery, "materialize_profile_dir", _fake_materialize)

    with caplog.at_level("WARNING", logger="jobify.hosted.discovery"):
        union = discovery._union_portal_targets(["user-a", "user-b"])

    assert union["greenhouse"] == [("beta", "Beta Inc")]
    assert any("user-a" in rec.message for rec in caplog.records)


# ── run_discovery_cycle: exactly-once dedup + upsert ────────────────────


def test_run_discovery_cycle_upserts_shared_posting_exactly_once(tmp_path, monkeypatch):
    """Two users both watch the same Greenhouse company. The real posting
    must be fetched once (one greenhouse.fetch() call, union-deduped) and
    upserted once — never once per user."""
    dir_a = _portals_dir(tmp_path, "user-a", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Co
""")
    dir_b = _portals_dir(tmp_path, "user-b", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Co
""")
    monkeypatch.setattr(
        discovery, "materialize_profile_dir",
        lambda user_id: {"user-a": dir_a, "user-b": dir_b}[user_id],
    )
    monkeypatch.setattr(db, "list_profile_user_ids", lambda: ["user-a", "user-b"])

    fetch_calls: list[list] = []
    apply_title_filter_seen: list[bool] = []

    def _fake_gh_fetch(targets=None, apply_title_filter=True):
        fetch_calls.append(list(targets or []))
        apply_title_filter_seen.append(apply_title_filter)
        yield _gh_job("acmeco")

    monkeypatch.setattr(greenhouse, "fetch", _fake_gh_fetch)

    upserted: list[dict] = []
    monkeypatch.setattr(db, "upsert_posting", lambda job: upserted.append(dict(job)))

    summary = discovery.run_discovery_cycle()

    assert len(fetch_calls) == 1, "greenhouse.fetch must be called exactly once per cycle"
    assert fetch_calls[0] == [("acmeco", "Acme Co")]
    assert apply_title_filter_seen == [False], (
        "discovery must bypass the per-profile title filter for the shared pool"
    )
    assert len(upserted) == 1
    assert upserted[0]["id"] == "gh-1"
    assert upserted[0]["link_status"] == "direct"
    assert upserted[0]["ats_kind"] == "greenhouse"
    assert summary == {
        "users": 2,
        "boards": {"greenhouse": 1, "lever": 0, "ashby": 0, "workday": 0},
        "fetched": 1,
        "upserted": 1,
        "dead": 0,
    }


def test_run_discovery_cycle_cross_source_dedup(tmp_path, monkeypatch):
    """The same canonical job id surfacing from two different sources
    (e.g. Greenhouse direct + a re-listing) collapses to one upsert."""
    d = _portals_dir(tmp_path, "user-a", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Co
lever:
  companies:
    - slug: acmeco
      name: Acme Co
""")
    monkeypatch.setattr(discovery, "materialize_profile_dir", lambda user_id: d)
    monkeypatch.setattr(db, "list_profile_user_ids", lambda: ["user-a"])

    monkeypatch.setattr(
        greenhouse, "fetch",
        lambda targets=None, apply_title_filter=True: iter([_gh_job("acmeco", jid="dup-1")]),
    )

    def _lever_dup(targets=None, apply_title_filter=True):
        job = _gh_job("acmeco", jid="dup-1")  # same canonical id, different source
        job["source"] = "lever"
        job["url"] = LEVER_URL
        yield job

    monkeypatch.setattr(lever, "fetch", _lever_dup)

    upserted: list[dict] = []
    monkeypatch.setattr(db, "upsert_posting", lambda job: upserted.append(dict(job)))

    summary = discovery.run_discovery_cycle()

    assert summary["fetched"] == 1
    assert len(upserted) == 1


def test_run_discovery_cycle_drops_dead_but_still_counts(tmp_path, monkeypatch):
    """A positively-dead aggregator posting is still upserted (with
    link_status='expired') rather than silently vanishing from the pool,
    matching the single-user pipeline's upsert-as-expired behavior."""
    d = _portals_dir(tmp_path, "user-a", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Co
""")
    monkeypatch.setattr(discovery, "materialize_profile_dir", lambda user_id: d)
    monkeypatch.setattr(db, "list_profile_user_ids", lambda: ["user-a"])

    dead_job = {
        "id": "dead-1",
        "source": "greenhouse",
        "title": "Closed Role",
        "company": "Acme Co",
        "location": "Remote",
        "description": "x" * 100,
        # A non-ATS aggregator URL so the resolver path (not the
        # direct-ATS short-circuit) runs and can report "dead".
        "url": "https://talent.com/view?id=dead",
    }
    monkeypatch.setattr(
        greenhouse, "fetch", lambda targets=None, apply_title_filter=True: iter([dead_job]),
    )

    from jobify.hunt import agent as hunt_agent

    monkeypatch.setattr(
        hunt_agent, "resolve_application_url",
        lambda url, *a, **k: {
            "resolved": url, "is_ats": False, "status_code": 404, "html": "",
        },
    )

    upserted: list[dict] = []
    monkeypatch.setattr(db, "upsert_posting", lambda job: upserted.append(dict(job)))

    summary = discovery.run_discovery_cycle()

    assert summary["dead"] == 1
    assert len(upserted) == 1
    assert upserted[0]["link_status"] == "expired"


def test_run_discovery_cycle_no_users_is_a_clean_noop(monkeypatch):
    monkeypatch.setattr(db, "list_profile_user_ids", lambda: [])
    monkeypatch.setattr(greenhouse, "fetch", lambda targets=None, apply_title_filter=True: iter(()))

    upserted: list[dict] = []
    monkeypatch.setattr(db, "upsert_posting", lambda job: upserted.append(job))

    summary = discovery.run_discovery_cycle()

    assert summary["users"] == 0
    assert summary["fetched"] == 0
    assert upserted == []


# ── the five fixed keyword-search sources (hn_whoshiring, ────────────────
# eighty_thousand_hours, remoteok, jsearch, serpapi) ─────────────────────


def _fixed_job(jid: str, source: str):
    """A job dict shaped like the fixed sources' output — a direct-ATS
    URL (greenhouse host) so link resolution short-circuits with zero
    HTTP, matching `_gh_job`'s convention above."""
    return {
        "id": jid,
        "source": source,
        "title": "Some Role",
        "company": "Acme Co",
        "location": "Remote",
        "description": "x" * 200,
        "url": f"https://boards.greenhouse.io/acmeco/jobs/{jid}",
    }


def test_run_discovery_cycle_fetches_all_nine_sources_exactly_once_not_per_user(
    tmp_path, monkeypatch,
):
    """Two users' profiles both resolve the same Greenhouse board (so the
    portal side has something to union), and the five fixed sources have
    no per-user configuration at all. Every one of the nine
    `jobify.hunt.sources` fetchers must be called exactly ONCE for the
    whole cycle — never once per user."""
    dir_a = _portals_dir(tmp_path, "user-a", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Co
""")
    dir_b = _portals_dir(tmp_path, "user-b", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Co
""")
    monkeypatch.setattr(
        discovery, "materialize_profile_dir",
        lambda user_id: {"user-a": dir_a, "user-b": dir_b}[user_id],
    )
    monkeypatch.setattr(db, "list_profile_user_ids", lambda: ["user-a", "user-b"])

    call_counts: dict[str, int] = {}

    def _counting_portal_fetch(name, jid):
        def _fetch(targets=None, apply_title_filter=True):
            call_counts[name] = call_counts.get(name, 0) + 1
            yield _fixed_job(jid, name)
        return _fetch

    def _counting_fixed_fetch(name, jid):
        def _fetch():
            call_counts[name] = call_counts.get(name, 0) + 1
            yield _fixed_job(jid, name)
        return _fetch

    monkeypatch.setattr(greenhouse, "fetch", _counting_portal_fetch("greenhouse", "gh-1"))
    monkeypatch.setattr(lever, "fetch", _counting_portal_fetch("lever", "lv-1"))
    monkeypatch.setattr(ashby, "fetch", _counting_portal_fetch("ashby", "as-1"))
    monkeypatch.setattr(workday, "fetch", _counting_portal_fetch("workday", "wd-1"))
    monkeypatch.setattr(hn_whoshiring, "fetch", _counting_fixed_fetch("hn_whoshiring", "hn-1"))
    monkeypatch.setattr(
        eighty_thousand_hours, "fetch", _counting_fixed_fetch("eighty_thousand_hours", "e8-1"),
    )
    monkeypatch.setattr(remoteok, "fetch", _counting_fixed_fetch("remoteok", "ro-1"))
    monkeypatch.setattr(jsearch, "fetch", _counting_fixed_fetch("jsearch", "js-1"))
    monkeypatch.setattr(serpapi, "fetch", _counting_fixed_fetch("serpapi", "sp-1"))

    # lever/ashby/workday also see the union'd board via portals.yml above
    # only for greenhouse; give them a nonempty union target too so their
    # fetchers actually run (targets=[] is skipped by `_iter_union_postings`).
    monkeypatch.setattr(
        discovery, "_union_portal_targets",
        lambda user_ids: {
            "greenhouse": [("acmeco", "Acme Co")],
            "lever": [("acmeco", "Acme Co")],
            "ashby": [("acmeco", "Acme Co")],
            "workday": [{"tenant": "acme", "site": "External", "dc": "wd1", "name": "Acme"}],
        },
    )

    upserted: list[dict] = []
    monkeypatch.setattr(db, "upsert_posting", lambda job: upserted.append(dict(job)))

    summary = discovery.run_discovery_cycle()

    assert call_counts == {
        "greenhouse": 1,
        "lever": 1,
        "ashby": 1,
        "workday": 1,
        "hn_whoshiring": 1,
        "eighty_thousand_hours": 1,
        "remoteok": 1,
        "jsearch": 1,
        "serpapi": 1,
    }
    assert summary["fetched"] == 9
    assert len(upserted) == 9


def test_run_discovery_cycle_dedups_across_all_nine_sources(tmp_path, monkeypatch):
    """The same canonical job id surfacing from a fixed source (e.g.
    remoteok) and a portal source collapses to one upsert, same as the
    existing cross-source dedup test for the four portal sources."""
    d = _portals_dir(tmp_path, "user-a", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Co
""")
    monkeypatch.setattr(discovery, "materialize_profile_dir", lambda user_id: d)
    monkeypatch.setattr(db, "list_profile_user_ids", lambda: ["user-a"])

    monkeypatch.setattr(
        greenhouse, "fetch",
        lambda targets=None, apply_title_filter=True: iter([_gh_job("acmeco", jid="dup-1")]),
    )

    def _remoteok_dup():
        yield _fixed_job("dup-1", "remoteok")  # same canonical id as greenhouse's job

    monkeypatch.setattr(remoteok, "fetch", _remoteok_dup)

    upserted: list[dict] = []
    monkeypatch.setattr(db, "upsert_posting", lambda job: upserted.append(dict(job)))

    summary = discovery.run_discovery_cycle()

    assert summary["fetched"] == 1
    assert len(upserted) == 1


# ── title-filter bypass (fix: discovery must not gate on one profile) ────


def test_discovery_bypasses_process_global_title_filter(tmp_path, monkeypatch):
    """A posting whose title WOULD fail the process-global default
    profile's title filter must still make it into the shared `postings`
    pool via `run_discovery_cycle` — proving the bypass is real, not just
    re-labeled.

    Unlike the other tests in this file, `greenhouse.fetch` is NOT
    monkeypatched wholesale here — only `greenhouse.fetch_json` (the
    network boundary) is faked, so the real `greenhouse._fetch_one` runs,
    including its real call into `sources._portals.passes_title_filter`.
    That function reads the process-global `_PORTALS_CACHE` (whichever
    ONE profile happens to be process-active) when no explicit
    `profile_dir` is passed — exactly what `_fetch_one` does. We seed
    that cache directly so the test doesn't depend on which profile
    (`profile/` vs `profile.example/`) happens to be active in this
    environment.
    """
    original_cache = _portals._PORTALS_CACHE
    _portals._PORTALS_CACHE = {
        "title_filter": {
            "reject_substrings": ["intern"],
            "prefer_substrings": [],
            "seniority_substrings": [],
        },
    }
    try:
        # Sanity check: prove the process-global filter really WOULD
        # reject this title before asserting the bypass lets it through
        # anyway — otherwise the test could pass for the wrong reason.
        assert _portals.passes_title_filter("Software Engineering Intern") is False

        d = _portals_dir(tmp_path, "user-a", """
greenhouse:
  companies:
    - slug: acmeco
      name: Acme Co
""")
        monkeypatch.setattr(discovery, "materialize_profile_dir", lambda user_id: d)
        monkeypatch.setattr(db, "list_profile_user_ids", lambda: ["user-a"])

        def _fake_fetch_json(url, **kwargs):
            return {
                "jobs": [
                    {
                        "title": "Software Engineering Intern",
                        "location": {"name": "Remote"},
                        "content": "<p>desc</p>",
                        "absolute_url": GH_URL,
                    },
                ],
            }

        monkeypatch.setattr(greenhouse, "fetch_json", _fake_fetch_json)

        upserted: list[dict] = []
        monkeypatch.setattr(db, "upsert_posting", lambda job: upserted.append(dict(job)))

        summary = discovery.run_discovery_cycle()

        assert summary["fetched"] == 1, (
            "the intern posting must survive discovery's title-filter bypass"
        )
        assert len(upserted) == 1
        assert upserted[0]["title"] == "Software Engineering Intern"
    finally:
        _portals._PORTALS_CACHE = original_cache
