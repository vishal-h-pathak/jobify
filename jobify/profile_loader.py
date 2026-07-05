"""jobify.profile_loader — single import surface for the user-layer profile.

Centralizes reads of the eight user-layer profile files so callers across
``jobify.hunt``, ``jobify.tailor``, and ``jobify.submit`` all hit one
consistent loader instead of resolving paths ad-hoc. WS-A1 consolidated the
contract: all eight files (``profile.yml``, ``thesis.md``, ``voice-profile.md``,
``article-digest.md``, ``learned-insights.md``, ``cv.md``, ``disqualifiers.yml``,
``portals.yml``) live under ONE directory that this module resolves. Nothing
outside this module should read a persona file by a hard-coded path.

Resolution order for the profile directory:
  1. ``JOBIFY_PROFILE_DIR`` environment variable, if set and non-empty
     (a real user's generated profile, or a test fixture).
  2. ``JOBIFY_PROFILE_USER_ID`` environment variable, if set — the hosted
     path (H2). Materializes the ``profiles.doc`` JSONB row for that user
     out of Supabase into a per-user cache directory and returns it; the
     dir-based loaders below do everything else unmodified. See
     ``materialize_profile_dir`` for the cache/re-materialize contract.
  3. ``<repo_root>/profile/`` if that directory exists (the active user's
     profile — onboarding writes here).
  4. ``<repo_root>/profile.example/`` — the shipped neutral example, so a
     fresh clone with no generated profile still loads *something* valid.

The repo root is found by walking up from this file until ``pyproject.toml``.

A missing profile dir or missing individual file is not fatal: dict loaders
return ``{}`` and string loaders return ``""``. Callers that need a stricter
contract should validate the result.

Fan-out safety (H4): ``profile_dir()`` is process-global (``@lru_cache`` +
``JOBIFY_PROFILE_USER_ID``) — it can only ever serve ONE user per process.
A hosted worker that scores many users' profiles in one process must NOT
go through it per-user. Two escape hatches exist for that caller:

  - ``materialize_profile_dir(user_id)`` materializes one user's profile
    into its own cache dir, independent of ``profile_dir()``'s cache and
    without touching any process-global env var.
  - Every ``load_*()`` function below takes an optional ``profile_dir``
    argument; pass the ``Path`` returned by ``materialize_profile_dir()``
    to read that user's files without resolving the global ``profile_dir()``
    at all. The zero-arg call remains exactly what it was — the global,
    env-var-driven resolution the single-user CLI (``jobify-hunt``) uses.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger("jobify.profile_loader")

# The eight user-layer files, matching the `profiles.doc` JSONB contract
# (H1's `0002_multitenant.sql`): keys = these filenames, values = file
# contents as text. Order here has no meaning beyond enumerating what to
# materialize.
DOC_FILENAMES = (
    "profile.yml",
    "thesis.md",
    "voice-profile.md",
    "article-digest.md",
    "learned-insights.md",
    "cv.md",
    "disqualifiers.yml",
    "portals.yml",
)

# Sentinel file written into a materialized cache dir recording the
# `profiles.updated_at` value that produced it, so re-materialization is
# skipped unless the DB row is actually newer.
_STAMP_FILENAME = ".materialized_updated_at"


def _walk_up_for_pyproject(start: Path) -> Optional[Path]:
    cur = start.resolve()
    for candidate in (cur, *cur.parents):
        if (candidate / "pyproject.toml").is_file():
            return candidate
    return None


def _profile_cache_root() -> Path:
    """Root directory under which per-user materialized profiles live.

    ``JOBIFY_PROFILE_CACHE`` overrides (tests, alternate deployments);
    otherwise ``~/.cache/jobify/profiles/``.
    """
    override = os.environ.get("JOBIFY_PROFILE_CACHE", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".cache" / "jobify" / "profiles"


def _parse_timestamp(value: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _cache_is_stale(stamp_path: Path, updated_at: str) -> bool:
    """True when the cached materialization must be refreshed.

    Cheap path: identical raw ``updated_at`` string means the row hasn't
    changed since the last materialization — skip. Otherwise parse both
    timestamps and re-materialize only when the DB row is strictly newer;
    if either timestamp fails to parse, fail safe and re-materialize.
    """
    if not stamp_path.is_file():
        return True
    cached_raw = stamp_path.read_text(encoding="utf-8").strip()
    if cached_raw == str(updated_at).strip():
        return False
    cached_ts = _parse_timestamp(cached_raw)
    new_ts = _parse_timestamp(updated_at)
    if cached_ts is not None and new_ts is not None:
        return new_ts > cached_ts
    return True


def _fetch_profile_row(user_id: str) -> dict:
    """Fetch the ``profiles`` row for ``user_id`` via the canonical data
    layer (``jobify.db``). Lazy import: keeps this module importable (and
    the non-DB resolution paths usable) without Supabase credentials set,
    matching ``jobify.db``'s own lazy-client pattern.
    """
    from jobify import db as _db  # noqa: PLC0415 — lazy, avoids import-time creds

    result = (
        _db.client.table("profiles")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    rows = getattr(result, "data", None) or []
    if not rows:
        raise RuntimeError(
            f"profile_loader: no profiles row found for user_id={user_id!r}"
        )
    return rows[0]


# Convention for `profiles.validation_status` (jobify/migrations/0004_worker.sql,
# additive TEXT column, no CHECK constraint): 'valid' when the materialized
# profile clears `onboarding.validate_profile`'s required checks, 'invalid'
# otherwise. The fan-out worker (H4 Task 3) reads this column to skip
# scoring for a user whose profile is broken, instead of silently running
# their (possibly malformed) rubric against every posting.
VALIDATION_STATUS_VALID = "valid"
VALIDATION_STATUS_INVALID = "invalid"


def _validate_materialized(cache_dir: Path, user_id: str) -> None:
    """Validate a freshly materialized cache dir and persist the verdict.

    Reuses ``onboarding.validate_profile``'s checks in-process (no
    subprocess, no env-var juggling — ``validate_profile_dir`` takes the
    directory directly). The verdict is written to
    ``profiles.validation_status`` via ``jobify.db`` so it GATES scoring
    (Task 3 skips a user with ``'invalid'``) rather than only being logged.
    A warning is still logged on failure as an operator signal, but the DB
    write — not the log line — is what downstream code reads.

    Best-effort on the DB write itself: a write hiccup here must not take
    down materialization (the cache dir is already usable on disk; the
    next cycle will retry the write).
    """
    status = VALIDATION_STATUS_VALID
    try:
        from onboarding.validate_profile import validate_profile_dir
    except ImportError:
        # NEVER silent: this exact silent-return hid the fact that the
        # deployed worker ran with the validation gate OFF (found 2026-07-04
        # — `onboarding/` isn't an installed package; console scripts don't
        # put the CWD on sys.path). The workflow sets PYTHONPATH to the
        # checkout; if this still fires, that wiring broke.
        logger.error(
            "onboarding.validate_profile not importable — validation gate is "
            "DISABLED for user_id=%s this run (set PYTHONPATH to the repo "
            "checkout; see conftest.py header)",
            user_id,
        )
        return
    report = validate_profile_dir(cache_dir)
    if not report.passed:
        status = VALIDATION_STATUS_INVALID
        logger.warning(
            "materialized profile for user_id=%s failed validation: %s",
            user_id,
            "; ".join(report.errors),
        )
    try:
        from jobify import db as _db  # noqa: PLC0415 — lazy, matches _fetch_profile_row

        _db.set_profile_validation_status(
            user_id, status,
            errors=tuple(report.errors) if not report.passed else (),
        )
    except Exception as exc:  # noqa: BLE001 — must not crash materialization
        logger.warning(
            "failed to write validation_status=%s for user_id=%s: %s",
            status, user_id, exc,
        )


def materialize_profile_dir(user_id: str) -> Path:
    """Materialize ``profiles.doc`` for ``user_id`` into its own cache dir,
    validate it, and return the dir. Re-fetches only when the cache is
    missing or stale (see ``_cache_is_stale``); otherwise reuses the
    existing files on disk.

    Independent of ``profile_dir()``'s process-global ``@lru_cache`` and
    touches no process-global env var (not ``JOBIFY_PROFILE_USER_ID``, not
    ``JOBIFY_PROFILE_DIR``) — safe to call once per user, in a loop, in the
    same process (the H4 fan-out worker's use case). The validation verdict
    lands in ``profiles.validation_status`` (see ``_validate_materialized``);
    callers that need it can re-query that column rather than parse a
    return value here.
    """
    cache_dir = _profile_cache_root() / user_id
    stamp_path = cache_dir / _STAMP_FILENAME

    row = _fetch_profile_row(user_id)
    updated_at = str(row.get("updated_at") or "")

    if _cache_is_stale(stamp_path, updated_at):
        doc = row.get("doc") or {}
        if not isinstance(doc, dict):
            raise RuntimeError(
                f"profile_loader: profiles.doc for user_id={user_id!r} is not "
                "a JSON object"
            )
        cache_dir.mkdir(parents=True, exist_ok=True)
        for name in DOC_FILENAMES:
            content = doc.get(name, "")
            (cache_dir / name).write_text(
                content if isinstance(content, str) else "", encoding="utf-8"
            )
        stamp_path.write_text(updated_at, encoding="utf-8")
        _validate_materialized(cache_dir, user_id)

    return cache_dir


def get_materialized_updated_at(profile_dir: Path) -> str:
    """Return the `profiles.updated_at` value recorded for `profile_dir` by
    the last `materialize_profile_dir()` call that wrote to it.

    Reads `_STAMP_FILENAME` back off disk — no DB round-trip — so callers
    that already hold a materialized dir (H4's fan-out worker, deciding
    whether to force a profile-embedding recompute) can compare against
    it without duplicating `_fetch_profile_row`. Returns `""` when the
    stamp file is missing (a dir not produced by `materialize_profile_dir`,
    e.g. `profile.example/` or a test fixture) rather than raising.
    """
    stamp_path = profile_dir / _STAMP_FILENAME
    if not stamp_path.is_file():
        return ""
    return stamp_path.read_text(encoding="utf-8").strip()


# Pre-H4 name, kept as an alias: `tests/test_profile_loader_db.py` and
# `profile_dir()` (below) both call this directly. No behavior difference —
# `materialize_profile_dir` IS `_materialize_from_db`, just under the public
# name the H4 fan-out worker calls it by.
_materialize_from_db = materialize_profile_dir


@lru_cache(maxsize=1)
def profile_dir() -> Path:
    """Resolve the user-layer profile directory.

    Honors ``JOBIFY_PROFILE_DIR`` first, then ``JOBIFY_PROFILE_USER_ID``
    (materializing from Supabase). Otherwise walks up from this module
    until ``pyproject.toml`` is found and prefers ``<repo_root>/profile`` when
    it exists (the active user's generated profile), falling back to
    ``<repo_root>/profile.example`` so a fresh clone loads the neutral example.
    """
    env_override = os.environ.get("JOBIFY_PROFILE_DIR", "").strip()
    if env_override:
        return Path(env_override).expanduser().resolve()

    user_id = os.environ.get("JOBIFY_PROFILE_USER_ID", "").strip()
    if user_id:
        return materialize_profile_dir(user_id)

    repo_root = _walk_up_for_pyproject(Path(__file__))
    if repo_root is None:
        raise RuntimeError(
            "profile_loader: could not locate pyproject.toml walking up from "
            f"{Path(__file__).resolve()}; set JOBIFY_PROFILE_DIR to override."
        )
    active = repo_root / "profile"
    if active.is_dir():
        return active
    return repo_root / "profile.example"


def _read_text(name: str, dir_override: Optional[Path] = None) -> str:
    """Read one profile file. ``dir_override`` reads from an explicit
    directory (the fan-out path); ``None`` resolves the process-global
    ``profile_dir()`` (the single-user CLI path) — the only two callers
    of this function distinguish that way, never a third resolution."""
    base = dir_override if dir_override is not None else profile_dir()
    path = base / name
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def _read_yaml(name: str, dir_override: Optional[Path] = None) -> dict:
    text = _read_text(name, dir_override)
    if not text.strip():
        return {}
    data = yaml.safe_load(text)
    return data if isinstance(data, dict) else {}


def _clear_cache_for_tests() -> None:
    """Reset the cached profile_dir() resolution. Test helper only."""
    profile_dir.cache_clear()


# ── Public loaders ──────────────────────────────────────────────────────────
#
# Every loader below takes an optional `profile_dir` argument. Omit it (the
# existing zero-arg call every current caller makes) and the loader resolves
# the process-global `profile_dir()` exactly as before — byte-compatible with
# pre-H4 behavior. Pass an explicit `Path` (e.g. from
# `materialize_profile_dir(user_id)`) to read that one profile without ever
# touching the global cache — the fan-out worker's path.


def load_thesis(profile_dir: Optional[Path] = None) -> str:
    """Return `profile/thesis.md` contents (empty string if missing).

    The hunting thesis is the canonical statement of judgment — tiers,
    hard constraints, the degree-gate rule, energy signals. Consumers
    that splice it into LLM prompts must place it FIRST and state that
    it overrides older profile prose on conflict (see
    ``jobify.hunt.prompts.build_profile_prompt_string``).
    """
    return _read_text("thesis.md", profile_dir)


def load_profile(profile_dir: Optional[Path] = None) -> dict:
    """Return the full parsed `profile.yml` as a dict."""
    return _read_yaml("profile.yml", profile_dir)


def load_profile_text(profile_dir: Optional[Path] = None) -> str:
    """Return the raw text of `profile.yml` (empty string if missing).

    Useful when callers want to splice the file into an LLM prompt
    verbatim — comments and key ordering survive — rather than re-emit a
    parsed dict via ``yaml.safe_dump``. Used by
    ``jobify.hunt.prompts.build_profile_prompt_string``.
    """
    return _read_text("profile.yml", profile_dir)


def load_archetypes(profile_dir: Optional[Path] = None) -> dict:
    """Return the `archetypes:` block from `profile.yml` (empty dict if missing)."""
    archetypes = load_profile(profile_dir).get("archetypes")
    return archetypes if isinstance(archetypes, dict) else {}


def load_application_defaults(profile_dir: Optional[Path] = None) -> dict:
    """Return the `application_defaults:` block from `profile.yml`.

    Single source of truth for canonical form-fill answers (work auth, start
    date, relocation, in-person, AI-policy ack, previous-interview map).
    """
    defaults = load_profile(profile_dir).get("application_defaults")
    return defaults if isinstance(defaults, dict) else {}


def load_resume_template(profile_dir: Optional[Path] = None) -> str:
    """Return the user's chosen resume template id from `profile.yml`.

    WS-F: the onboarding flow lets the user pick one template from the
    ``jobify.resume_templates`` gallery; the choice is stored as a top-level
    ``resume_template`` string in ``profile.yml`` and honored by the tailor
    (``jobify.tailor.tailor.latex_resume._select_template``). Returns ``""``
    when unset or not a string, so the tailor falls back to its default; the
    tailor — not this loader — validates the id against the gallery.
    """
    value = load_profile(profile_dir).get("resume_template")
    return value.strip() if isinstance(value, str) else ""


def load_cv(profile_dir: Optional[Path] = None) -> str:
    """Return `cv.md` contents (master CV markdown; empty string if missing).

    The single source of truth for resume content. Read by the hunt scorer
    and the tailor; tailoring may *select* and *reorder* from it but never
    invents beyond it.
    """
    return _read_text("cv.md", profile_dir)


def load_disqualifiers(profile_dir: Optional[Path] = None) -> dict:
    """Return the parsed `disqualifiers.yml` as a dict (empty dict if missing).

    Shape: ``hard_disqualifiers`` (list) + ``soft_concerns`` (list). Read by
    the scorer to short-circuit / penalize jobs.
    """
    return _read_yaml("disqualifiers.yml", profile_dir)


def load_disqualifiers_text(profile_dir: Optional[Path] = None) -> str:
    """Return the raw text of `disqualifiers.yml` (empty string if missing).

    Used when splicing the file verbatim into an LLM prompt (comments and
    ordering survive) rather than re-emitting a parsed dict.
    """
    return _read_text("disqualifiers.yml", profile_dir)


def load_portals(profile_dir: Optional[Path] = None) -> dict:
    """Return the parsed `portals.yml` as a dict (empty dict if missing).

    Shape: per-ATS ``{greenhouse,lever,ashby,workday}.companies`` lists plus a
    ``title_filter`` block. Read by the hunt sources (``jobify.hunt.sources``)
    to know which boards to poll and how to pre-filter titles before scoring.
    """
    return _read_yaml("portals.yml", profile_dir)


def load_article_digest(profile_dir: Optional[Path] = None) -> str:
    """Return `profile/article-digest.md` contents (empty string if missing)."""
    return _read_text("article-digest.md", profile_dir)


def load_learned_insights(profile_dir: Optional[Path] = None) -> str:
    """Return `profile/learned-insights.md` contents (empty string if missing)."""
    return _read_text("learned-insights.md", profile_dir)


def load_voice_profile(profile_dir: Optional[Path] = None) -> dict:
    """Parse `profile/voice-profile.md` into a section-keyed dict.

    Splits on top-level `## ` headings; keys are kebab-cased section titles,
    values are the raw section bodies. The full unparsed text is also
    returned under the `raw` key so callers can pass the whole file to an
    LLM unmodified when needed.
    """
    text = _read_text("voice-profile.md", profile_dir)
    out: dict[str, object] = {"raw": text}
    if not text.strip():
        return out

    sections: dict[str, str] = {}
    current_key: Optional[str] = None
    buf: list[str] = []
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            if current_key is not None:
                sections[current_key] = "\n".join(buf).strip()
            title = m.group(1).strip().lower()
            current_key = re.sub(r"[^a-z0-9]+", "-", title).strip("-")
            buf = []
        elif current_key is not None:
            buf.append(line)
    if current_key is not None:
        sections[current_key] = "\n".join(buf).strip()

    out["sections"] = sections
    return out
