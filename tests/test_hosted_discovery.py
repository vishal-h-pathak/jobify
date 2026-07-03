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
from sources import ashby, greenhouse, lever, workday

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
    Lever/Ashby/Workday silent so the union-dedup assertions aren't
    muddied by unrelated fetch calls."""
    monkeypatch.setattr(lever, "fetch", lambda targets=None: iter(()))
    monkeypatch.setattr(ashby, "fetch", lambda targets=None: iter(()))
    monkeypatch.setattr(workday, "fetch", lambda tenants=None: iter(()))


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

    def _fake_gh_fetch(targets=None):
        fetch_calls.append(list(targets or []))
        yield _gh_job("acmeco")

    monkeypatch.setattr(greenhouse, "fetch", _fake_gh_fetch)

    upserted: list[dict] = []
    monkeypatch.setattr(db, "upsert_posting", lambda job: upserted.append(dict(job)))

    summary = discovery.run_discovery_cycle()

    assert len(fetch_calls) == 1, "greenhouse.fetch must be called exactly once per cycle"
    assert fetch_calls[0] == [("acmeco", "Acme Co")]
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
        lambda targets=None: iter([_gh_job("acmeco", jid="dup-1")]),
    )

    def _lever_dup(targets=None):
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
    monkeypatch.setattr(greenhouse, "fetch", lambda targets=None: iter([dead_job]))

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
    monkeypatch.setattr(greenhouse, "fetch", lambda targets=None: iter(()))

    upserted: list[dict] = []
    monkeypatch.setattr(db, "upsert_posting", lambda job: upserted.append(job))

    summary = discovery.run_discovery_cycle()

    assert summary["users"] == 0
    assert summary["fetched"] == 0
    assert upserted == []
