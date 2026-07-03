#!/usr/bin/env python3
"""Validate a generated profile directory against the frozen WS-A1 contract.

The onboarding flow (``onboarding/SKILL.md``) calls this after writing the eight
profile files so the interview can re-ask for anything missing BEFORE the user
walks away with a profile the pipeline will choke on. It is also the gate the
golden-example test (``tests/test_onboarding_example.py``) runs in CI.

What it checks
--------------
1. The directory loads through ``jobify.profile_loader`` (the *only* import
   surface the rest of the pipeline uses) — i.e. it passes the target dir
   directly to ``profile_loader``'s dir-parameterized loaders (never touching
   ``JOBIFY_PROFILE_DIR`` or the loader's ``lru_cache``) and exercises every
   public loader. A file that parses here is a file hunt/tailor/submit will
   read identically.
2. The two YAML files with machine schemas (``profile.yml``, ``disqualifiers.yml``,
   ``portals.yml``) validate against ``onboarding/schema/*.schema.json``. If the
   optional ``jsonschema`` package is installed the full Draft 2020-12 check
   runs; otherwise a built-in required-key fallback runs so the script never
   hard-depends on a package outside the project's runtime deps.
3. The five prose files are non-empty where the contract calls them
   "Recommended", and contain the structural markers downstream prompts expect
   (e.g. voice-profile.md must yield at least one ``## `` section; article-digest
   must carry a "do not invent" guardrail). These are WARNINGS, not errors —
   the loaders degrade gracefully — but a good profile clears them.

Usage
-----
    python onboarding/validate_profile.py ./profile
    python onboarding/validate_profile.py ./profile --json
    # exit 0 = all required checks pass; exit 1 = at least one ERROR.

Design note: required-field failures are ERRORS (exit 1); quality gaps are
WARNINGS (exit 0). The onboarding skill re-asks on ERRORs and surfaces WARNINGs
for the user to optionally fill.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

# ── repo wiring ──────────────────────────────────────────────────────────────
# This script lives at <repo>/onboarding/validate_profile.py. Put the repo root
# on sys.path so `import jobify.profile_loader` works when run directly from a
# fresh checkout without an editable install.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SCHEMA_DIR = Path(__file__).resolve().parent / "schema"
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# ── result accumulator ───────────────────────────────────────────────────────
class Report:
    """Collects ERROR / WARN / OK lines and renders them for human or machine."""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.oks: list[str] = []

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def ok(self, msg: str) -> None:
        self.oks.append(msg)

    @property
    def passed(self) -> bool:
        return not self.errors

    def render_text(self) -> str:
        lines: list[str] = []
        for m in self.oks:
            lines.append(f"  ✓ {m}")
        for m in self.warnings:
            lines.append(f"  ⚠ WARN  {m}")
        for m in self.errors:
            lines.append(f"  ✗ ERROR {m}")
        head = (
            "PROFILE VALID (required checks passed)"
            if self.passed
            else f"PROFILE INVALID — {len(self.errors)} error(s) must be fixed"
        )
        if self.warnings:
            head += f"; {len(self.warnings)} warning(s)"
        return "\n".join([head, *lines])

    def render_json(self) -> str:
        return json.dumps(
            {
                "passed": self.passed,
                "errors": self.errors,
                "warnings": self.warnings,
                "oks": self.oks,
            },
            indent=2,
        )


# ── schema validation (optional jsonschema, with required-key fallback) ──────
def _load_schema(name: str) -> Optional[dict]:
    path = _SCHEMA_DIR / name
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _required_keys(schema: dict) -> list[str]:
    return list(schema.get("required", []))


def _validate_against_schema(
    data: Any, schema: dict, label: str, rep: Report
) -> None:
    """Validate `data` against `schema`. Uses jsonschema if present, else a
    shallow required-key walk that covers the contract's hard-required keys."""
    try:
        import jsonschema  # type: ignore

        try:
            jsonschema.validate(instance=data, schema=schema)
            rep.ok(f"{label}: valid against {schema.get('title', 'schema')}")
        except jsonschema.ValidationError as exc:  # type: ignore[attr-defined]
            loc = "/".join(str(p) for p in exc.absolute_path) or "(root)"
            rep.error(f"{label}: schema violation at {loc}: {exc.message}")
        return
    except ImportError:
        pass

    # Fallback: required-key check only (no jsonschema installed).
    if not isinstance(data, dict):
        rep.error(f"{label}: expected a mapping at the top level")
        return
    missing = [k for k in _required_keys(schema) if k not in data]
    if missing:
        rep.error(f"{label}: missing required key(s): {', '.join(missing)}")
    # one level deep for nested required blocks the contract cares about
    for key, subschema in schema.get("properties", {}).items():
        if (
            isinstance(subschema, dict)
            and subschema.get("type") == "object"
            and key in data
            and isinstance(data[key], dict)
        ):
            sub_missing = [
                k for k in _required_keys(subschema) if k not in data[key]
            ]
            if sub_missing:
                rep.error(
                    f"{label}: '{key}' missing required key(s): "
                    f"{', '.join(sub_missing)}"
                )
    if not missing:
        rep.ok(f"{label}: required keys present (jsonschema not installed — "
               "shallow check)")


# ── prose-file quality checks ────────────────────────────────────────────────
def _check_nonempty(text: str, fname: str, rep: Report, *, required: bool) -> bool:
    if text.strip():
        return True
    (rep.error if required else rep.warn)(
        f"{fname}: empty (the loader returns '' — downstream quality degrades)"
    )
    return False


def validate_profile_dir(target: Path) -> Report:
    """Run every profile check against `target` and return the `Report`.

    Factored out of `main()` (H2) so callers that already have a directory
    on disk — e.g. `jobify.profile_loader`'s DB-backed materialization —
    can validate in-process without shelling out to this script. Reads
    `target` through `profile_loader`'s dir-parameterized loaders (H4) —
    it does NOT mutate `JOBIFY_PROFILE_DIR` or the loader's `lru_cache`,
    so it's safe to call once per user, in a loop, in the same process
    (the hosted fan-out worker materializes and validates many users'
    profiles this way without ever touching a process-global env var).
    """
    rep = Report()

    if not target.is_dir():
        rep.error(f"{target}: not a directory")
        return rep

    try:
        from jobify import profile_loader
    except Exception as exc:  # pragma: no cover - import wiring
        rep.error(f"could not import jobify.profile_loader: {exc!r}")
        return rep

    # ── profile.yml (hard-required structure) ───────────────────────
    profile = profile_loader.load_profile(target)
    if not profile:
        rep.error("profile.yml: missing or not a mapping (REQUIRED file)")
    else:
        schema = _load_schema("profile.schema.json")
        if schema:
            _validate_against_schema(profile, schema, "profile.yml", rep)
        # extra targeted checks the schema can't express cleanly
        defaults = profile_loader.load_application_defaults(target)
        if defaults:
            piv = defaults.get("previous_interview_with_company")
            if piv is not None and not isinstance(piv, dict):
                rep.error(
                    "profile.yml: application_defaults.previous_interview_with_company "
                    "must be a map of company-slug -> bool (may be {})"
                )

    # ── disqualifiers.yml ────────────────────────────────────────────
    disq = profile_loader.load_disqualifiers(target)
    schema = _load_schema("disqualifiers.schema.json")
    if not disq:
        rep.warn("disqualifiers.yml: missing/empty (scorer can't floor bad roles)")
    elif schema:
        _validate_against_schema(disq, schema, "disqualifiers.yml", rep)

    # ── portals.yml (hunt needs it) ──────────────────────────────────
    portals = profile_loader.load_portals(target)
    schema = _load_schema("portals.schema.json")
    if not portals:
        rep.warn("portals.yml: missing/empty (jobify-hunt has no boards to poll)")
    elif schema:
        _validate_against_schema(portals, schema, "portals.yml", rep)

    # ── prose files ───────────────────────────────────────────────────
    thesis = profile_loader.load_thesis(target)
    if _check_nonempty(thesis, "thesis.md", rep, required=False):
        if not re.search(r"(?im)^#\s+\S", thesis):
            rep.warn("thesis.md: no top-level '# ' title (scorer banner reads odd)")
        rep.ok("thesis.md: present")

    voice = profile_loader.load_voice_profile(target)
    if _check_nonempty(voice.get("raw", ""), "voice-profile.md", rep, required=False):
        sections = voice.get("sections") or {}
        if not sections:
            rep.error(
                "voice-profile.md: no '## ' sections — loader yields an empty "
                "sections dict and the tailor loses all voice guidance"
            )
        else:
            rep.ok(f"voice-profile.md: {len(sections)} section(s) parsed")

    digest = profile_loader.load_article_digest(target)
    if _check_nonempty(digest, "article-digest.md", rep, required=False):
        if not re.search(r"(?i)do not (have|invent)", digest):
            rep.warn(
                "article-digest.md: no 'do not invent' guardrail section — the "
                "tailor's anti-fabrication fence is weaker without it"
            )
        rep.ok("article-digest.md: present")

    cv = profile_loader.load_cv(target)
    if _check_nonempty(cv, "cv.md", rep, required=False):
        rep.ok("cv.md: present")

    # learned-insights.md is fully optional and ships ~empty; never warn.
    _ = profile_loader.load_learned_insights(target)

    return rep


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "profile_dir",
        nargs="?",
        default="./profile",
        help="Directory holding the eight profile files (default: ./profile).",
    )
    parser.add_argument(
        "--json", action="store_true", help="Emit a machine-readable JSON report."
    )
    args = parser.parse_args(argv)

    target = Path(args.profile_dir).expanduser().resolve()
    rep = validate_profile_dir(target)
    print(rep.render_json() if args.json else rep.render_text())
    return 0 if rep.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
