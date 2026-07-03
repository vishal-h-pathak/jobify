"""H1 RLS isolation tests for the hosted multi-tenant tables
(jobify/migrations/0002_multitenant.sql).

Requires a live Supabase project — either a local stack (``supabase
start``, run from a directory with a Supabase CLI project) or a real
project — reachable via three env vars:

    SUPABASE_URL               project URL
    SUPABASE_SERVICE_ROLE_KEY  service-role key (setup/teardown: create
                                users, seed a posting, clean up)
    SUPABASE_ANON_KEY          anon/publishable key (used to sign in as
                                each seeded user and exercise RLS as they
                                would see it)

Both migrations (0001_init.sql then 0002_multitenant.sql) must already be
applied to that project. Skips cleanly (not a failure) when any of the
three env vars is absent, per the H1 session prompt's exit criteria.

Run locally:

    supabase start                       # from a supabase-cli project dir
    export SUPABASE_URL=http://127.0.0.1:54321
    export SUPABASE_SERVICE_ROLE_KEY=<service_role from `supabase status`>
    export SUPABASE_ANON_KEY=<anon from `supabase status`>
    pytest -m integration tests/test_rls_multitenant.py -v

See also jobify/migrations/README.md "0002 — hosted multi-tenant tables".
"""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.integration

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY):
    pytest.skip(
        "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY not all "
        "set — skipping RLS isolation tests (need a local `supabase start` "
        "stack or a real project)",
        allow_module_level=True,
    )

from supabase import Client, create_client  # noqa: E402  (after the env-gated skip)

TEST_PASSWORD = "h1-rls-test-password-not-real"


def _service_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _anon_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


def _create_user(service: Client) -> tuple[str, str]:
    """Create a confirmed test user; return (user_id, email)."""
    email = f"h1-rls-{uuid.uuid4().hex}@example.invalid"
    resp = service.auth.admin.create_user(
        {"email": email, "password": TEST_PASSWORD, "email_confirm": True}
    )
    return resp.user.id, email


def _signed_in_client(email: str) -> Client:
    """A fresh anon-key client signed in as the given user."""
    client = _anon_client()
    client.auth.sign_in_with_password({"email": email, "password": TEST_PASSWORD})
    return client


@pytest.fixture
def two_users():
    """Seed two auth users + a shared posting + one profiles/matches row
    each, via the service-role client (bypasses RLS). Tears everything
    down afterwards — deleting the auth users cascades to profiles/
    matches/budget_ledger/api_keys via their FKs; the posting is deleted
    explicitly since it has no owner to cascade from."""
    service = _service_client()

    user_a_id, user_a_email = _create_user(service)
    user_b_id, user_b_email = _create_user(service)

    posting_id = f"h1-rls-test-{uuid.uuid4().hex[:16]}"
    service.table("postings").insert(
        {
            "id": posting_id,
            "title": "RLS Test Posting",
            "company": "Acme",
            "application_url": "https://example.invalid/job",
        }
    ).execute()

    for uid in (user_a_id, user_b_id):
        service.table("profiles").insert(
            {"user_id": uid, "doc": {"profile.yml": "identity: test\n"}}
        ).execute()
        service.table("matches").insert(
            {"user_id": uid, "posting_id": posting_id, "state": "new"}
        ).execute()

    try:
        yield {
            "posting_id": posting_id,
            "user_a": {"id": user_a_id, "email": user_a_email},
            "user_b": {"id": user_b_id, "email": user_b_email},
        }
    finally:
        service.table("postings").delete().eq("id", posting_id).execute()
        service.auth.admin.delete_user(user_a_id)
        service.auth.admin.delete_user(user_b_id)


def test_each_user_sees_own_profile_and_match_rows(two_users):
    client_a = _signed_in_client(two_users["user_a"]["email"])

    own_profile = client_a.table("profiles").select("*").execute().data
    assert [row["user_id"] for row in own_profile] == [two_users["user_a"]["id"]]

    own_matches = client_a.table("matches").select("*").execute().data
    assert [row["user_id"] for row in own_matches] == [two_users["user_a"]["id"]]


def test_neither_user_sees_the_others_rows(two_users):
    client_a = _signed_in_client(two_users["user_a"]["email"])
    client_b = _signed_in_client(two_users["user_b"]["email"])

    profiles_seen_by_a = {row["user_id"] for row in client_a.table("profiles").select("*").execute().data}
    profiles_seen_by_b = {row["user_id"] for row in client_b.table("profiles").select("*").execute().data}
    assert two_users["user_b"]["id"] not in profiles_seen_by_a
    assert two_users["user_a"]["id"] not in profiles_seen_by_b

    matches_seen_by_a = {row["user_id"] for row in client_a.table("matches").select("*").execute().data}
    matches_seen_by_b = {row["user_id"] for row in client_b.table("matches").select("*").execute().data}
    assert two_users["user_b"]["id"] not in matches_seen_by_a
    assert two_users["user_a"]["id"] not in matches_seen_by_b


def test_anon_sees_nothing_on_new_tables(two_users):
    anon = _anon_client()

    assert anon.table("profiles").select("*").execute().data == []
    assert anon.table("matches").select("*").execute().data == []
    assert anon.table("budget_ledger").select("*").execute().data == []
    assert anon.table("api_keys").select("*").execute().data == []


def test_authed_user_can_read_postings_but_cannot_write(two_users):
    client_a = _signed_in_client(two_users["user_a"]["email"])

    postings = client_a.table("postings").select("*").eq("id", two_users["posting_id"]).execute().data
    assert [row["id"] for row in postings] == [two_users["posting_id"]]

    with pytest.raises(Exception):
        client_a.table("postings").insert(
            {"id": f"h1-rls-should-fail-{uuid.uuid4().hex[:8]}", "title": "nope"}
        ).execute()
