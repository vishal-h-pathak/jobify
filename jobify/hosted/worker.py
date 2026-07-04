"""jobify.hosted.worker — hosted-worker cycle entry point (H4 Task 4).

Composes Task 2's global discovery (`jobify.hosted.discovery.run_discovery_cycle`)
and Task 3's per-user fan-out ladder (`jobify.hosted.fanout.run_fanout_cycle`)
into one cycle: discovery fills the shared `postings` pool, then fan-out
scores it per user. Console script `jobify-hosted-hunt` (declared in
`pyproject.toml`) calls `run()`, mirroring `jobify.hunt.agent.run()`'s
single-user console-script pattern — `argparse`, single-shot (no internal
loop; cron / the GHA workflow handles recurrence), logger calls PLUS a
`print(...)` summary line for terminal / GHA step-summary visibility.

This module reimplements nothing from Task 2/3 — it only calls their two
entry functions in order and formats a combined summary from their
already-named return-dict fields.

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


def _summary_line(
    discovery_summary: dict,
    fanout_summary: dict,
    global_spend: float | None = None,
    global_cap: float | None = None,
) -> str:
    """Render both cycles' summary dicts as one terminal/GHA-step-summary
    line. Field names are read straight off Task 2/3's own return-dict
    shapes (`discovery.run_discovery_cycle` / `fanout.run_fanout_cycle`
    docstrings) rather than inventing new bookkeeping here.

    ``global_spend`` / ``global_cap`` (H7) are optional — appended as a
    ``pool_spend=$X/$Y`` field when both are provided. Neither summary
    dict carries pool spend, so `_execute()` fetches it fresh at cycle
    end and passes it in here rather than this function reaching into
    `jobify.db` / `jobify.config` itself.
    """
    line = (
        "done. "
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


def _execute() -> dict:
    """Run one hosted-worker cycle: discovery, then fan-out, then a
    combined summary. See the module docstring for the failure-isolation
    policy between the two phases (discovery is not wrapped — a whole-
    phase failure propagates and aborts the cycle before fan-out runs).
    """
    logger.info("hosted worker cycle starting")

    discovery_summary = discovery.run_discovery_cycle()
    fanout_summary = fanout.run_fanout_cycle()

    # Neither summary dict carries pool spend (H6's cap ledger lives in
    # `jobify.db`, not either phase's return value) — fetched fresh here
    # so the cycle telemetry line always reflects spend as of cycle end.
    global_spend = db.get_global_month_to_date_spend()
    global_cap = config.HOSTED_GLOBAL_MONTHLY_CAP_USD
    summary_line = _summary_line(
        discovery_summary, fanout_summary, global_spend, global_cap
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
    parser.parse_args()
    _execute()


if __name__ == "__main__":
    run()
