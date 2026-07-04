"""jobify.hosted.invites — invite-minting ops CLI (H7 Launch Part A Task 3).

Hosted onboarding (`0003_hosted_onboarding.sql`) gates signup behind an
`invites` row: a code, who minted it (`created_by`, nullable), and who
claimed it (`claimed_by` / `claimed_at`, both null until claimed). There
is no `authenticated`-role INSERT policy on the table — only a
service-role client can mint a code — so this is deliberately an
operator-run CLI, not a web-exposed endpoint.

Console script `jobify-hosted-invite` (declared in `pyproject.toml`)
calls `run()`, mirroring `jobify.hosted.worker.run()`'s own
argparse-then-dispatch shape (this codebase's convention across every
console script — no click anywhere in the tree).

Two independent operations:
  --mint N   generate N fresh codes, insert each as an `invites` row,
             print the plain codes (one per line) so an operator can
             paste them into invite links / emails.
  --list     print every `invites` row's claim status for a quick
             "who's used their invite" ops check.
"""

from __future__ import annotations

import argparse
import secrets
import sys

from jobify import db


def mint_invites(n: int) -> list[str]:
    """Generate `n` unguessable invite codes, insert each into `invites`,
    and return the list of codes.

    Codes are `secrets.token_urlsafe(9)` (cryptographically unguessable,
    same primitive the stdlib recommends for tokens), lowercased —
    `token_urlsafe`'s alphabet includes `-`/`_` and mixed case, and
    lowercasing keeps codes easy to read/type without losing entropy
    (the code space is still large enough that collision risk is a
    non-concern for an ops-run mint of a handful of codes at a time; no
    collision check is performed here on purpose).

    `created_by` / `claimed_by` / `claimed_at` are all left unset — this
    is a CLI, not a per-user action, so there's no minting user to
    attribute the row to, and the code is unclaimed until someone signs
    up with it.
    """
    codes = [secrets.token_urlsafe(9).lower() for _ in range(n)]
    for code in codes:
        db.client.table("invites").insert({"code": code}).execute()
    return codes


def list_invites() -> list[dict]:
    """Return every `invites` row (code, created_by, claimed_by,
    claimed_at, created_at) exactly as `.select("*").execute().data`
    comes back — no extra sorting imposed here (mirrors
    `jobify.db.list_profile_user_ids`'s unpaginated, unsorted read at
    this same ops scale).
    """
    return db.client.table("invites").select("*").execute().data or []


def _print_mint(codes: list[str]) -> None:
    """Plain codes, one per line — no decoration. An operator copy/pastes
    these straight into invite links, so anything extra (a header, a
    table) would just have to be stripped back out."""
    for code in codes:
        print(code)


def _print_list(rows: list[dict]) -> None:
    """Simple aligned columns: code, claimed_by (or "unclaimed"),
    claimed_at (or "—"). This is an ops CLI, not a UI — readability over
    polish."""
    for row in rows:
        code = row.get("code", "")
        claimed_by = row.get("claimed_by") or "unclaimed"
        claimed_at = row.get("claimed_at") or "—"
        print(f"{code:<16} {claimed_by:<38} {claimed_at}")


def run() -> None:
    """Console-script entry point: parse CLI args and dispatch.

    Wired as ``jobify-hosted-invite = jobify.hosted.invites:run`` in
    pyproject.toml. Neither flag given -> print help and exit non-zero
    (there's nothing useful to do with no args, unlike jobify-hosted-hunt
    whose default IS to run a cycle).
    """
    parser = argparse.ArgumentParser(
        prog="jobify-hosted-invite",
        description="hosted onboarding: mint or list invite codes",
    )
    parser.add_argument(
        "--mint", type=int, metavar="N",
        help="Mint N fresh invite codes and print them, one per line.",
    )
    parser.add_argument(
        "--list", action="store_true",
        help="List every invite code and its claim status.",
    )
    args = parser.parse_args()

    if args.mint is not None:
        _print_mint(mint_invites(args.mint))
    elif args.list:
        _print_list(list_invites())
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    run()
