"""jobify.hosted.worker — hosted-worker cycle entry point (H4 Task 4).

Composes Task 2's global discovery (`jobify.hosted.discovery.run_discovery_cycle`)
and Task 3's per-user fan-out ladder (`jobify.hosted.fanout.run_fanout_cycle`)
into one cycle: discovery fills the shared `postings` pool, then (unless
told otherwise) fan-out scores it per user. Console script
`jobify-hosted-hunt` (declared in `pyproject.toml`) calls `run()`,
mirroring `jobify.hunt.agent.run()`'s single-user console-script pattern —
`argparse`, single-shot (no internal loop; cron / the GHA workflow handles
recurrence), logger calls PLUS a `print(...)` summary line for terminal /
GHA step-summary visibility.

This module reimplements nothing from Task 2/3 — it only calls their two
entry functions in order and formats a combined summary from their
already-named return-dict fields.

HNT-1 (`planning/session-prompts/21_user_triggered_hunts.md`): scoring
stopped being automatic. Three invocation shapes now exist, chosen by
`run()`'s CLI flags: no flags = original behavior (discovery + fan-out
for every user, kept for compat with an ad-hoc manual dispatch);
`--discovery-only` = the daily cron, discovery only, zero fan-out/LLM
spend; `--user <uuid>` = a "Run my hunt" trigger-route dispatch,
discovery then fan-out for that one user only.

Failure isolation between the two phases (documented per the brief):
`jobify.hunt.agent`'s own posture is per-SOURCE resilience *inside* a
phase (`iter_all_jobs`'s try/except around each source fetch) but NO
top-level try/except wrapping the phase as a whole — a failure that
survives the per-item guards is allowed to propagate and abort the run,
not be silently swallowed. This module applies the same philosophy one
level up, at the phase boundary: discovery's own per-source resilience
(Task 2) and fan-out's own per-user resilience (Task 3) already isolate
failures *within* each phase. If `run_discovery_cycle()` itself raises —
a whole-phase failure, not a single source's — `_execute()` does NOT
catch it. The exception propagates, the process exits non-zero, and
fan-out never runs. Running fan-out against a stale/partial `postings`
pool left by a crashed discovery phase would silently score users
against incomplete data with no signal that anything went wrong; letting
the whole cycle abort (loudly, in the cron/GHA logs) is the same
fail-loud choice `jobify.hunt.agent._execute()` makes for anything above
its own per-item guards.
"""

from __future__ import annotations

import argparse
import logging

from jobify import config, db
from jobify.hosted import discovery, fanout
from jobify.notify import send_ntfy_summary

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("jobify.hosted.worker")


_EMPTY_FANOUT_SUMMARY: dict[str, int] = {
    "users_processed": 0,
    "users_skipped_invalid": 0,
    "users_errored": 0,
    "postings_scored": 0,
    "matches_written": 0,
    "stage4_calls": 0,
    "users_budget_stopped": 0,
}


def _summary_line(
    mode: str,
    discovery_summary: dict,
    fanout_summary: dict,
    global_spend: float | None = None,
    global_cap: float | None = None,
) -> str:
    """Render both cycles' summary dicts as one terminal/GHA-step-summary
    line. Field names are read straight off Task 2/3's own return-dict
    shapes (`discovery.run_discovery_cycle` / `fanout.run_fanout_cycle`
    docstrings) rather than inventing new bookkeeping here.

    ``mode`` (HNT-1) is one of ``"full"``, ``"discovery_only"``, or
    ``"user:<uuid>"`` — surfaced up front so a GHA log/ntfy line makes it
    obvious which of the three invocation shapes actually ran.

    ``global_spend`` / ``global_cap`` (H7) are optional — appended as a
    ``pool_spend=$X/$Y`` field when both are provided. Neither summary
    dict carries pool spend, so `_execute()` fetches it fresh at cycle
    end and passes it in here rather than this function reaching into
    `jobify.db` / `jobify.config` itself.
    """
    line = (
        f"done. mode={mode} "
        f"discovery: users={discovery_summary.get('users')} "
        f"fetched={discovery_summary.get('fetched')} "
        f"upserted={discovery_summary.get('upserted')} "
        f"dead={discovery_summary.get('dead')} | "
        f"fanout: processed={fanout_summary.get('users_processed')} "
        f"skipped_invalid={fanout_summary.get('users_skipped_invalid')} "
        f"errored={fanout_summary.get('users_errored')} "
        f"postings_scored={fanout_summary.get('postings_scored')} "
        f"matches_written={fanout_summary.get('matches_written')} "
        f"stage4_calls={fanout_summary.get('stage4_calls')} "
        f"budget_stopped={fanout_summary.get('users_budget_stopped')}"
    )
    if global_spend is not None and global_cap is not None:
        line += f" | pool_spend=${global_spend:.2f}/${global_cap:.2f}"
    return line


def _execute(discovery_only: bool = False, user_id: str | None = None) -> dict:
    """Run one hosted-worker cycle: discovery, then (unless
    ``discovery_only``) fan-out, then a combined summary. See the module
    docstring for the failure-isolation policy between the two phases
    (discovery is not wrapped — a whole-phase failure propagates and
    aborts the cycle before fan-out runs).

    HNT-1: scoring is no longer automatic-for-everyone every cycle.
    ``discovery_only=True`` (the daily cron) runs discovery and skips
    fan-out entirely — zero LLM spend, just keeps the shared `postings`
    pool fresh. ``user_id`` (a user's own "Run my hunt" trigger) still
    runs discovery first (it's free/idempotent, and the triggering
    user's own fan-out benefits from a fresh pool) then fans out for
    ONLY that one user via `fanout.run_fanout_cycle`'s existing
    ``user_ids`` targeting hook — no fanout.py changes needed. Passing
    both is contradictory and rejected by `run()`'s argparse before this
    is ever called.
    """
    mode = f"user:{user_id}" if user_id else ("discovery_only" if discovery_only else "full")
    logger.info("hosted worker cycle starting (mode=%s)", mode)

    discovery_summary = discovery.run_discovery_cycle()
    if discovery_only:
        fanout_summary = dict(_EMPTY_FANOUT_SUMMARY)
    else:
        fanout_summary = fanout.run_fanout_cycle(user_ids=[user_id] if user_id else None)

    # Neither summary dict carries pool spend (H6's cap ledger lives in
    # `jobify.db`, not either phase's return value) — fetched fresh here
    # so the cycle telemetry line always reflects spend as of cycle end.
    global_spend = db.get_global_month_to_date_spend()
    global_cap = config.HOSTED_GLOBAL_MONTHLY_CAP_USD
    summary_line = _summary_line(
        mode, discovery_summary, fanout_summary, global_spend, global_cap
    )

    # Logs/print always fire regardless of ntfy's outcome (unset topic,
    # network failure, etc.) — the ntfy push is an additional side-effect
    # on top of cycle visibility, not a gate on it.
    logger.info(
        "hosted worker cycle done: discovery=%s fanout=%s",
        discovery_summary, fanout_summary,
    )
    print(summary_line)
    send_ntfy_summary(summary_line)

    return {"discovery": discovery_summary, "fanout": fanout_summary}


def run() -> None:
    """Console-script entry point: parse CLI args and run one hosted
    worker cycle.

    Wired as ``jobify-hosted-hunt = jobify.hosted.worker:run`` in
    pyproject.toml. Intentionally single-shot, same as ``jobify-hunt``'s
    own ``run()`` — no internal looping. Daemonise via cron / the GHA
    ``hosted-hunt.yml`` workflow / launchd if you want recurring
    execution.

    HNT-1: three mutually exclusive invocation shapes.
    ``--discovery-only`` (the daily cron) and ``--user <uuid>`` (a
    trigger-route dispatch) can't both be set — that's a contradiction
    in intent, not something to silently resolve one way, so it's a
    parser error. No flags at all keeps the original behavior (discovery
    + fan-out for every user) for compat with an ad-hoc manual dispatch.
    """
    parser = argparse.ArgumentParser(
        prog="jobify-hosted-hunt",
        description="hosted worker: global discovery + per-user fan-out scoring ladder",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Documented no-op, mirroring jobify-hunt's own flag. The "
             "worker always runs one cycle and exits; the flag exists so "
             "cron / the GHA workflow can pass it for intent-clarity "
             "without breaking.",
    )
    parser.add_argument(
        "--discovery-only",
        action="store_true",
        help="Run discovery only, zero fan-out — no LLM spend. Used by "
             "the daily cron now that scoring is user-triggered (HNT-1).",
    )
    parser.add_argument(
        "--user",
        metavar="UUID",
        default=None,
        help="Run discovery, then fan-out for ONLY this one user. Used "
             "by the 'Run my hunt' trigger route dispatch (HNT-1).",
    )
    args = parser.parse_args()
    if args.discovery_only and args.user:
        parser.error("--discovery-only and --user are mutually exclusive")
    _execute(discovery_only=args.discovery_only, user_id=args.user)


if __name__ == "__main__":
    run()
