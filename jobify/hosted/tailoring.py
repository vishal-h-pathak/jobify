"""jobify.hosted.tailoring — hosted tailor-run worker (V3B S1, Task 5b).

One process = one dispatched ``tailor_runs`` row = one user. Mirrors
``jobify.hosted.worker``'s single-shot console-script composition
(claim → run → mark terminal) and ``jobify.hosted.fanout``'s BYO/budget
posture, but the per-run isolation model here is simpler than fanout's
per-user loop: fanout scores MANY users in one process and therefore
never touches the zero-arg, process-global ``jobify.profile_loader``
resolution path. This worker handles exactly ONE user per process (one
GHA job per dispatched ``run_id``, per ``planning/V3B_DESIGN.md`` §1.1),
so it is safe — and necessary — to do what fanout deliberately avoids:
set ``JOBIFY_PROFILE_DIR`` once, as the very first thing this module's
entry point does, and then call straight into the *single-user* tailor
subtree (``jobify.tailor.tailor.*`` / ``jobify.tailor.prompts``), which
reads the profile via that zero-arg, `@lru_cache`-memoized path. Getting
the ordering wrong — importing/calling a tailor module before the env
var is set, or handling two users in one process — is exactly the
single-user-to-hosted seam the design doc calls the most fragile part of
this worker: get it wrong and one user's profile silently leaks into
another's generation.

── The reused subtree (bare imports, sys.path bootstrap) ───────────────────

``jobify/tailor/tailor/*.py`` and ``jobify/tailor/prompts/*.py`` use
unprefixed imports (``from tailor.X import Y``, ``from prompts import
Z``) inherited from when that code ran as its own repo with the tailor
directory as CWD. ``jobify.tailor.pipeline`` (the single-user entry
point) inserts ``jobify/tailor/`` onto ``sys.path`` before importing any
of them; this module replicates that exact bootstrap at the top of the
file, before any other import, rather than importing ``pipeline`` itself
(which drags in submit-side browser/Stagehand dependencies this worker
has no use for).

Every reused piece below is reached via a **module object** import
(``from tailor import latex_resume as latex_mod``, not
``from tailor.latex_resume import generate_tailored_latex_with_usage``)
and called via attribute access (``latex_mod.generate_tailored_latex_with_usage(...)``).
This matters for one specific reason: this worker also needs two
underscore-prefixed helpers from that SAME module
(``_fit_to_one_page`` / ``_compile_and_count_factory``) to re-run the
one-page trim/compile loop a second time, on the post-verification,
dropped-down resume. A direct-name import (``from tailor.latex_resume
import _fit_to_one_page``) copies a reference at import time that a
test's ``monkeypatch.setattr(latex_resume_module, "_compile_and_count_factory",
fake)`` would NOT reach (the copied name still points at the original
function). Going through the module object for every call site means a
single monkeypatch on that module's attribute is visible everywhere,
including from *within* ``latex_resume.py``'s own
``_compile_tailored_latex`` — same module object, same attribute lookup
at call time.

── Sequence (design §4 S1) ──────────────────────────────────────────────────

``run(run_id)`` claims the ``tailor_runs`` row (``running``), then:

  - ``mode == "render"``: zero-LLM short-circuit. Re-render both PDFs
    from what's already in Storage (the post-trim ``tailored.json`` +
    ``claims.json`` a prior ``mode="tailor"`` run produced), re-upload
    all 6 objects, mark succeeded with the EXISTING dropped-count/
    doc_sha256 (derived from the downloaded ``claims.json``, since this
    dispatch's OWN ``tailor_runs`` row starts out with those columns
    NULL) and ``cost_usd=0.0``. Used by the template switcher and
    post-edit re-renders (§3.4).
  - ``mode == "tailor"`` (default): materialize the profile, gate
    budget/BYO, then five LLM calls in order — archetype, resume, LaTeX
    (produces the pre-verification ``tailored_data``), cover letter,
    claim attribution — each landing one ``budget_ledger`` row. The
    claims verifier (``jobify.tailor.claims``, pure, no LLM) then decides
    what survives; this module drops the rest from both the resume dict
    and the cover-letter text, re-runs the one-page trim/compile loop on
    the smaller resume, renders the final cover-letter PDF, and uploads
    all 6 objects. `tailor_runs` lands ``succeeded`` (dropped_count,
    cost_usd, doc_sha256) or ``failed`` (error) — see ``_run_pipeline``'s
    try/except/mark-failed-then-reraise discipline, mirroring
    ``jobify.hosted.worker._execute``'s fail-loud posture for a
    whole-run failure.

Console script: ``jobify-hosted-tailor --run <run_id>`` (wired in
``pyproject.toml``), mirroring ``jobify.hosted.worker.run()``'s
argparse-then-execute shape.
"""

from __future__ import annotations

# ── sys.path bootstrap — MUST run before any other import in this file ─────
# Same pattern as jobify/tailor/pipeline.py's own bootstrap, relocated for
# this file's position (jobify/hosted/tailoring.py -> jobify/tailor/).
# Inserting jobify/tailor/ onto sys.path is what makes the reused subtree's
# bare `from tailor.X import Y` / `from prompts import Z` imports resolve.
import sys as _sys
from pathlib import Path as _Path

_TAILOR_DIR = str((_Path(__file__).resolve().parent.parent / "tailor").resolve())
if _TAILOR_DIR not in _sys.path:
    _sys.path.insert(0, _TAILOR_DIR)
del _sys, _Path, _TAILOR_DIR
# ─────────────────────────────────────────────────────────────────────────

import argparse  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402
import logging  # noqa: E402
import os  # noqa: E402
import tempfile  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any, Optional  # noqa: E402

from jobify import config, db  # noqa: E402
from jobify.hosted.keycrypt import KeyDecryptionError, decrypt_key  # noqa: E402
from jobify.profile_loader import (  # noqa: E402
    load_article_digest,
    load_cv,
    materialize_profile_dir,
)
from jobify.resume_templates import DEFAULT_TEMPLATE_ID, is_valid_template_id  # noqa: E402
from jobify.shared import llm, storage  # noqa: E402
from jobify.tailor import claims  # noqa: E402

# Reused single-user tailor subtree — bare imports, module objects (see the
# module docstring for why attribute access, not direct-name import).
from prompts import cached_system_blocks, load_task_prompt  # noqa: E402
from tailor import archetype as archetype_mod  # noqa: E402
from tailor import cover_letter as cover_letter_mod  # noqa: E402
from tailor import cover_letter_pdf as cover_letter_pdf_mod  # noqa: E402
from tailor import latex_resume as latex_mod  # noqa: E402
from tailor import resume as resume_mod  # noqa: E402

logger = logging.getLogger("jobify.hosted.tailoring")

# ── Pricing (Sonnet-class; mirrors fanout.py's RUBRIC_COMPILE_* env-tunable
# constant convention — TAILOR_CLAUDE_MODEL is Sonnet-class per config.py, so
# the same $3/$15 per-MTok defaults apply). Small, in-file, additive per the
# brief's ownership fence — no jobify.config touch needed for this. ─────────
_TAILOR_INPUT_USD_PER_MTOK = float(os.environ.get("TAILOR_INPUT_USD_PER_MTOK", "3.0"))
_TAILOR_OUTPUT_USD_PER_MTOK = float(os.environ.get("TAILOR_OUTPUT_USD_PER_MTOK", "15.0"))

# The 6 storage object names under job-materials/{user_id}/{posting_id}/
# (design §1.4). Order matches the design doc's own listing.
_RESUME_PDF = "resume.pdf"
_COVER_LETTER_PDF = "cover_letter.pdf"
_COVER_LETTER_TXT = "cover_letter.txt"
_TAILORED_JSON = "tailored.json"
_CLAIMS_JSON = "claims.json"
_RENDER_META_JSON = "render_meta.json"


def _cost_usd(usage: "llm.CompletionUsage") -> float:
    return round(
        usage.input_tokens / 1_000_000 * _TAILOR_INPUT_USD_PER_MTOK
        + usage.output_tokens / 1_000_000 * _TAILOR_OUTPUT_USD_PER_MTOK,
        6,
    )


def _record_ledger(
    run_id: str, user_id: str, event: str, usage: "llm.CompletionUsage", byo_key: Optional[str],
) -> float:
    """Write one ``budget_ledger`` row for one of the 5 LLM call sites and
    return its cost (so the caller can accumulate the run's total)."""
    cost = _cost_usd(usage)
    db.insert_budget_ledger_row(
        user_id, event,
        model=config.TAILOR_CLAUDE_MODEL,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cost_usd=cost,
        run_id=run_id,
        byo=bool(byo_key),
    )
    return cost


def _resolve_byo_key(user_id: str) -> Optional[str]:
    """Same posture as ``jobify.hosted.fanout._resolve_byo_key``: a
    decryption failure degrades to ``None`` (pool path), logged not
    raised — never crashes the run over a rotated/corrupted BYO key."""
    ciphertext = db.get_api_key_ciphertext(user_id)
    if not ciphertext:
        return None
    try:
        return decrypt_key(ciphertext)
    except KeyDecryptionError as exc:
        logger.error(
            "tailoring: BYO key decrypt failed for user_id=%s (falling back "
            "to pool-with-caps): %s", user_id, exc,
        )
        return None


def _compute_doc_sha256(cv_text: str, article_digest_text: str) -> str:
    """Deterministic hash pinning the profile-doc snapshot verified
    against (design §2.1's ``claims.json.doc_sha256`` / the
    ``tailor_runs.doc_sha256`` column) — the same value feeds both."""
    return hashlib.sha256((cv_text + article_digest_text).encode("utf-8")).hexdigest()


def _build_job(posting: dict) -> dict:
    """Build the ``job`` dict shape the reused tailor-subtree functions
    read (title/company/description/location/url/tier) from a hosted
    ``postings`` row.

    Judgment call: ``tier`` and ``degree_gated`` have no hosted-V3b
    equivalent yet — no per-user scoring artifact is threaded onto a
    posting the way the single-user ``jobs`` row carries them.  ``tier``
    is left as the literal string ``"unknown"`` (every reader already
    treats a missing/unparseable tier that way); ``degree_gated`` is
    simply omitted (``prompts.degree_gate_block`` reads it as falsy and
    no-ops, so ungated framing is used for every hosted tailor for now).
    ``match_chat_transcript`` (the single-user "Match Agent" dashboard
    chat) has no hosted equivalent either and is likewise omitted.
    """
    return {
        "title": posting.get("title") or "",
        "company": posting.get("company") or "",
        "description": posting.get("description") or "",
        "location": posting.get("location") or "",
        "url": posting.get("application_url") or posting.get("url") or "",
        "tier": "unknown",
    }


# ── Claim-unit construction (design §2.1's id scheme) ───────────────────────


def _build_resume_units(tailored_data: dict) -> list[dict]:
    """Flatten the post-latex-call ``tailored_data`` dict into the
    proposed-unit list ``claims.verify_claims`` expects, per the id
    scheme documented in ``jobify.tailor.claims``'s render-rule section:
    ``r.exp{i}.header``, ``r.exp{i}.b{j}`` (j = a running index across
    ALL of that experience's projects, in project/bullet order — NOT
    per-project), ``r.edu{i}``, ``r.skill{i}`` (i = 0-based index over
    ``skills.items()`` insertion order), ``r.summary`` (only if
    ``summary_line`` is non-null).

    Bullet/bullet_sources alignment: zips ``bullets[j]`` with
    ``bullet_sources[j]`` for ``j in range(len(bullets))`` only. The
    one-page trim loop (``latex_resume._trim_one_unit``) pops trailing
    bullets but not their sources, so after a trim ``bullet_sources`` for
    a trimmed project can be LONGER than ``bullets`` — iterating by
    ``bullets``'s own length (not zip()'s shortest-of-both, which would
    accidentally do the right thing here anyway, but iterating explicitly
    documents the invariant) never indexes past what's actually rendered.
    """
    units: list[dict] = []

    for i, exp in enumerate(tailored_data.get("experience") or []):
        units.append({
            "id": f"r.exp{i}.header",
            "surface": "resume",
            "kind": "header",
            "fields": {
                "org": exp.get("org") or "",
                "title": exp.get("title") or "",
                "location": exp.get("location") or "",
                "period": exp.get("period") or "",
            },
        })
        bullet_idx = 0
        for proj in exp.get("projects") or []:
            bullets = proj.get("bullets") or []
            bullet_sources = proj.get("bullet_sources") or []
            for j in range(len(bullets)):
                sources = bullet_sources[j] if j < len(bullet_sources) else []
                units.append({
                    "id": f"r.exp{i}.b{bullet_idx}",
                    "surface": "resume",
                    "kind": "bullet",
                    "text": bullets[j],
                    "sources": sources,
                })
                bullet_idx += 1

    for i, edu in enumerate(tailored_data.get("education") or []):
        units.append({
            "id": f"r.edu{i}",
            "surface": "resume",
            "kind": "edu",
            "fields": {
                "school": edu.get("school") or "",
                "degree": edu.get("degree") or "",
                "period": edu.get("period") or "",
            },
        })

    skills = tailored_data.get("skills") or {}
    skills_sources = tailored_data.get("skills_sources") or {}
    for i, (category, value) in enumerate(skills.items()):
        units.append({
            "id": f"r.skill{i}",
            "surface": "resume",
            "kind": "skill",
            "text": value,
            "sources": skills_sources.get(category) or [],
        })

    summary_line = tailored_data.get("summary_line")
    if summary_line:
        units.append({
            "id": "r.summary",
            "surface": "resume",
            "kind": "summary",
            "text": summary_line,
            "sources": tailored_data.get("summary_sources") or [],
        })

    return units


def _build_cl_units(attribution_data: dict) -> list[dict]:
    """Cover-letter units come straight from the attribution call's own
    JSON response — its ids (``cl.s0``, ``cl.s1``, ...) are minted by the
    prompt itself (``attribute_claims.md``), never re-derived here. The
    prompt's output deliberately omits ``surface`` (it only ever produces
    cover-letter units); stamping it on is this function's whole job.
    """
    units: list[dict] = []
    for u in attribution_data.get("units") or []:
        units.append({
            "id": u.get("id"),
            "surface": "cover_letter",
            "kind": u.get("kind"),
            "text": u.get("text") or "",
            "sources": u.get("sources") or [],
        })
    return units


# ── Drop + rebuild (design §2.4's render rule, applied to the JSON dict) ───


def _filter_tailored_data(tailored_data: dict, survivors: set[str]) -> dict:
    """Rebuild ``tailored_data`` containing only surviving units.

    Header-drop cascade (a case ``claims.drop_unverified`` does NOT
    itself decide): if ``r.exp{i}.header`` is not in ``survivors`` — it
    failed rule 3's structural check — the WHOLE experience entry is
    dropped, even if some of its bullets independently verified. The
    reverse (header survives, zero bullets survive) is already handled by
    ``drop_unverified``'s own empty-experience cascade, so a header that
    IS in ``survivors`` is trusted to have at least one surviving bullet
    (or the entry is dropped here anyway when the filtered bullet list
    comes up empty, as a defensive backstop).
    """
    filtered = dict(tailored_data)

    new_experience: list[dict] = []
    for i, exp in enumerate(tailored_data.get("experience") or []):
        header_id = f"r.exp{i}.header"
        if header_id not in survivors:
            continue
        bullet_idx = 0
        new_projects: list[dict] = []
        for proj in exp.get("projects") or []:
            bullets = proj.get("bullets") or []
            new_bullets: list[str] = []
            for bullet_text in bullets:
                bullet_id = f"r.exp{i}.b{bullet_idx}"
                if bullet_id in survivors:
                    new_bullets.append(bullet_text)
                bullet_idx += 1
            if new_bullets:
                new_proj = {k: v for k, v in proj.items() if k != "bullet_sources"}
                new_proj["bullets"] = new_bullets
                new_projects.append(new_proj)
        if new_projects:
            new_exp = {k: v for k, v in exp.items() if k != "projects"}
            new_exp["projects"] = new_projects
            new_experience.append(new_exp)
    filtered["experience"] = new_experience

    filtered["education"] = [
        edu for i, edu in enumerate(tailored_data.get("education") or [])
        if f"r.edu{i}" in survivors
    ]

    skills = tailored_data.get("skills") or {}
    filtered["skills"] = {
        category: value
        for i, (category, value) in enumerate(skills.items())
        if f"r.skill{i}" in survivors
    }

    summary_line = tailored_data.get("summary_line")
    filtered["summary_line"] = (
        summary_line if summary_line and "r.summary" in survivors else None
    )

    filtered.pop("skills_sources", None)
    filtered.pop("summary_sources", None)
    return filtered


def _filter_cl_text(attribution_data: dict, survivors: set[str]) -> str:
    """Rebuild the cover-letter body from surviving ``cl.s{i}`` units,
    in original order.

    Documented simplification: the attribution response carries no
    paragraph/positional hint beyond sentence order, so surviving
    sentences are joined with a single space rather than reconstructing
    the original paragraph breaks. Acceptable for S1 — flagged in the
    task report for a second look (S3's editor surface may want to
    revisit if joined letters read too dense).
    """
    parts = [
        (u.get("text") or "")
        for u in (attribution_data.get("units") or [])
        if u.get("id") in survivors
    ]
    return " ".join(p for p in parts if p)


# ── LaTeX render helper (shared by the tailor-mode final render + render
#    mode's re-render) ──────────────────────────────────────────────────────


def _render_and_compile(tailored_data: dict, style: str, company: str) -> dict:
    """Run the one-page trim/compile loop once on ``tailored_data`` in the
    given ``style``. Same tempdir pattern
    ``latex_resume._compile_tailored_latex`` uses internally.

    Called twice across this module's two paths: once (tailor mode) on
    the post-verification, dropped-down resume — which, since dropping
    only removes content, will essentially always already fit one page,
    but running the guarantee loop again is cheap and safe — and once
    (render mode) on the stored ``tailored.json`` re-rendered in a
    (possibly new) template.
    """
    safe_company = "".join(c if c.isalnum() else "_" for c in (company or ""))
    with tempfile.TemporaryDirectory(prefix="hosted_tailor_") as td:
        return latex_mod._fit_to_one_page(
            tailored_data, style,
            latex_mod._compile_and_count_factory(Path(td), safe_company),
        )


def _upload_materials(
    storage_prefix: str,
    resume_pdf_bytes: bytes,
    cover_pdf_bytes: bytes,
    cover_letter_text: str,
    tailored_data: dict,
    claims_data: dict,
    style: str,
    pages: Optional[int],
) -> None:
    """Upload the 6 job-materials objects (design §1.4)."""
    storage.upload_bytes(f"{storage_prefix}/{_RESUME_PDF}", resume_pdf_bytes, "application/pdf")
    storage.upload_bytes(f"{storage_prefix}/{_COVER_LETTER_PDF}", cover_pdf_bytes, "application/pdf")
    storage.upload_bytes(
        f"{storage_prefix}/{_COVER_LETTER_TXT}", cover_letter_text.encode("utf-8"), "text/plain",
    )
    storage.upload_bytes(
        f"{storage_prefix}/{_TAILORED_JSON}",
        json.dumps(tailored_data).encode("utf-8"), "application/json",
    )
    storage.upload_bytes(
        f"{storage_prefix}/{_CLAIMS_JSON}",
        json.dumps(claims_data).encode("utf-8"), "application/json",
    )
    render_meta = {
        "style": style,
        "pages": pages,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    storage.upload_bytes(
        f"{storage_prefix}/{_RENDER_META_JSON}",
        json.dumps(render_meta).encode("utf-8"), "application/json",
    )


# ── mode=render short-circuit ────────────────────────────────────────────────


def _resolve_render_style(run: dict, render_meta: dict) -> str:
    requested = (run.get("template") or "").strip()
    if requested and is_valid_template_id(requested):
        return requested
    stored = (render_meta.get("style") or "").strip()
    if stored and is_valid_template_id(stored):
        return stored
    return DEFAULT_TEMPLATE_ID


def _run_render_mode(run: dict, storage_prefix: str) -> None:
    """Zero-LLM re-render: pull the existing post-trim ``tailored.json``
    + ``claims.json`` (+ ``render_meta.json`` for the stored style) out of
    Storage, re-render both PDFs, re-upload all 6 objects, mark
    succeeded. No LLM call and no ``budget_ledger`` row anywhere in this
    function — that is the contract a test must assert.
    """
    run_id = run["id"]
    posting_id = run["posting_id"]

    postings = db.get_postings_by_ids([posting_id])
    posting = postings[0] if postings else {}

    tailored_data = json.loads(storage.download_bytes(f"{storage_prefix}/{_TAILORED_JSON}"))
    claims_data = json.loads(storage.download_bytes(f"{storage_prefix}/{_CLAIMS_JSON}"))
    render_meta = json.loads(storage.download_bytes(f"{storage_prefix}/{_RENDER_META_JSON}"))
    cover_letter_text = storage.download_bytes(f"{storage_prefix}/{_COVER_LETTER_TXT}").decode("utf-8")

    style = _resolve_render_style(run, render_meta)

    final = _render_and_compile(tailored_data, style, posting.get("company") or "")
    if not final.get("compile_success"):
        raise RuntimeError(
            f"render-mode resume compile failed: {final.get('compile_log') or '(no log)'}"[:1000]
        )

    cover_pdf_bytes = cover_letter_pdf_mod.render_cover_letter_pdf(
        cover_letter_text, company=posting.get("company"), role=posting.get("title"),
    )

    _upload_materials(
        storage_prefix,
        final["pdf_bytes"], cover_pdf_bytes, cover_letter_text,
        final["tailored_data"], claims_data, style, final.get("pages"),
    )

    db.mark_tailor_run_succeeded(
        run_id,
        dropped_count=len(claims_data.get("dropped") or []),
        cost_usd=0.0,
        doc_sha256=claims_data.get("doc_sha256") or "",
    )


# ── mode=tailor (the full pipeline) ──────────────────────────────────────────


def _run_tailor_mode(run: dict, storage_prefix: str, profile_dir: Path) -> None:
    run_id = run["id"]
    user_id = run["user_id"]
    posting_id = run["posting_id"]

    db.append_tailor_run_progress(run_id, "profile", "reading your profile")

    # ── Budget/BYO gate — re-checked here (dispatch->run gap), before the
    # first LLM call, per design §1.5. A single gate, not re-checked
    # mid-pipeline (unlike fanout's mid-batch recheck over a loop of many
    # postings) — a tailor run is one job with 5 calls, not a loop. ───────
    byo_key = _resolve_byo_key(user_id)
    if not byo_key:
        if db.get_month_to_date_spend(user_id) >= db.get_budget_cap(user_id):
            db.mark_tailor_run_failed(run_id, "budget cap reached — try again next month")
            return
        if db.get_global_month_to_date_spend() >= config.HOSTED_GLOBAL_MONTHLY_CAP_USD:
            db.mark_tailor_run_failed(
                run_id, "shared pool budget exhausted this month — try again next month",
            )
            return

    postings = db.get_postings_by_ids([posting_id])
    if not postings:
        raise RuntimeError(f"postings row not found for posting_id={posting_id!r}")
    posting = postings[0]
    job = _build_job(posting)

    cv_text = load_cv(profile_dir)
    article_digest_text = load_article_digest(profile_dir)
    doc_sha256 = _compute_doc_sha256(cv_text, article_digest_text)

    cost_total = 0.0

    # ── 1/5: archetype ───────────────────────────────────────────────────
    archetype_result, usage = archetype_mod.classify_archetype_with_usage(job)
    job["_archetype"] = archetype_result
    cost_total += _record_ledger(run_id, user_id, "tailor_archetype", usage, byo_key)
    db.append_tailor_run_progress(run_id, "frame", "choosing the frame")

    # ── 2/5: resume tailoring context ────────────────────────────────────
    tailoring_result, usage = resume_mod.tailor_resume_with_usage(job)
    cost_total += _record_ledger(run_id, user_id, "tailor_resume", usage, byo_key)

    # ── 3/5: LaTeX resume (pre-verification tailored_data + style) ──────
    latex_result, usage = latex_mod.generate_tailored_latex_with_usage(job, tailoring_result)
    cost_total += _record_ledger(run_id, user_id, "tailor_latex", usage, byo_key)
    db.append_tailor_run_progress(run_id, "resume", "drafting the resume")

    if not latex_result.get("compile_success"):
        raise RuntimeError(
            f"resume LaTeX compile failed: {latex_result.get('compile_log') or '(no log)'}"[:1000]
        )

    tailored_data = latex_result["tailored_data"]
    style = latex_result["style"]

    # ── 4/5: cover letter ─────────────────────────────────────────────────
    cover_result, usage = cover_letter_mod.generate_cover_letter_with_usage(
        job, resume_tailoring=tailoring_result,
    )
    cover_letter_text = cover_result.get("cover_letter") or ""
    cost_total += _record_ledger(run_id, user_id, "tailor_cover", usage, byo_key)
    db.append_tailor_run_progress(run_id, "cover_letter", "writing the cover letter")

    # ── 5/5: claim attribution (new prompt, no *_with_usage sibling — call
    # complete_with_usage directly) ──────────────────────────────────────
    attribution_prompt = load_task_prompt(
        "attribute_claims", cover_letter_text=cover_letter_text, cv_markdown=cv_text,
    )
    llm_kwargs: dict[str, Any] = dict(
        system=cached_system_blocks(),
        prompt=attribution_prompt,
        model=config.TAILOR_CLAUDE_MODEL,
        max_tokens=2000,
    )
    if byo_key:
        llm_kwargs["api_key"] = byo_key
    attribution_text, usage = llm.complete_with_usage(**llm_kwargs)
    cost_total += _record_ledger(run_id, user_id, "tailor_claims", usage, byo_key)
    attribution_data = archetype_mod._extract_json(attribution_text)

    # ── Verify (pure, no LLM) + drop ─────────────────────────────────────
    db.append_tailor_run_progress(run_id, "verify", "checking every claim against your profile")
    proposed_units = _build_resume_units(tailored_data) + _build_cl_units(attribution_data)
    claims_result = claims.verify_claims(
        proposed_units,
        cv_text=cv_text, article_digest_text=article_digest_text, doc_sha256=doc_sha256,
    )
    survivors = claims.drop_unverified(claims_result)

    filtered_tailored = _filter_tailored_data(tailored_data, survivors)
    filtered_cl_text = _filter_cl_text(attribution_data, survivors)
    if not filtered_cl_text.strip():
        raise RuntimeError("cover letter text is empty after claims verification")

    # ── Final render (re-runs the one-page guarantee on the smaller
    # resume) + upload ───────────────────────────────────────────────────
    db.append_tailor_run_progress(run_id, "render", "rendering PDFs")
    final = _render_and_compile(filtered_tailored, style, posting.get("company") or "")
    if not final.get("compile_success"):
        raise RuntimeError(
            f"final resume LaTeX compile failed: {final.get('compile_log') or '(no log)'}"[:1000]
        )

    cover_pdf_bytes = cover_letter_pdf_mod.render_cover_letter_pdf(
        filtered_cl_text, company=posting.get("company"), role=posting.get("title"),
    )

    _upload_materials(
        storage_prefix,
        final["pdf_bytes"], cover_pdf_bytes, filtered_cl_text,
        final["tailored_data"], claims_result, style, final.get("pages"),
    )

    db.mark_tailor_run_succeeded(
        run_id,
        dropped_count=len(claims_result.get("dropped") or []),
        cost_usd=round(cost_total, 6),
        doc_sha256=doc_sha256,
    )


# ── Orchestration ────────────────────────────────────────────────────────────


def _run_pipeline(run: dict) -> None:
    """Materialize the profile (the load-bearing ordering seam — see the
    module docstring), then dispatch to the render or tailor path."""
    user_id = run["user_id"]
    posting_id = run["posting_id"]
    storage_prefix = f"{user_id}/{posting_id}"

    # THIS ORDERING IS LOAD-BEARING: materialize, then set the env var,
    # BEFORE calling into any tailor/prompts function (both paths below
    # need it — render mode still builds identity headers via
    # profile_loader.load_profile(), the zero-arg process-global path).
    profile_dir = materialize_profile_dir(user_id)
    os.environ["JOBIFY_PROFILE_DIR"] = str(profile_dir)

    if (run.get("mode") or "tailor") == "render":
        _run_render_mode(run, storage_prefix)
        return

    _run_tailor_mode(run, storage_prefix, profile_dir)


def _execute(run_id: str) -> None:
    """Claim the ``tailor_runs`` row and run it to a terminal state.

    ``run_id`` not resolving to a row is a caller error (the web route
    must have inserted it before dispatching) — fail loud, no failed-row
    write (there's no row to write to). Everything from ``mark_tailor_run_running``
    onward is wrapped in one try/except/mark-failed-then-reraise, mirroring
    ``jobify.hosted.worker._execute``'s fail-loud posture: a mid-pipeline
    crash lands a clean ``failed`` row (visible to the cockpit) AND still
    propagates so the GHA job shows red for ops visibility.
    """
    run = db.get_tailor_run(run_id)
    if run is None:
        raise RuntimeError(f"tailor_runs row not found for run_id={run_id!r}")

    db.mark_tailor_run_running(run_id)

    try:
        _run_pipeline(run)
    except Exception as exc:  # noqa: BLE001 — record, then re-raise (fail-loud, see docstring)
        logger.exception("tailoring: run_id=%s failed", run_id)
        db.mark_tailor_run_failed(run_id, str(exc))
        raise


def run() -> None:
    """Console-script entry point: ``jobify-hosted-tailor --run <run_id>``.

    Argparse, single-shot — mirrors ``jobify.hosted.worker.run()``'s
    shape. One dispatch = one ``run_id`` = one GHA job.
    """
    parser = argparse.ArgumentParser(
        prog="jobify-hosted-tailor",
        description="hosted tailor worker: execute one tailor_runs dispatch",
    )
    parser.add_argument(
        "--run", required=True, metavar="RUN_ID", dest="run_id",
        help="tailor_runs.id to execute",
    )
    args = parser.parse_args()
    _execute(args.run_id)


if __name__ == "__main__":
    run()
