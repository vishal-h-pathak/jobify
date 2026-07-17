"""tests/test_hosted_tailoring.py — jobify.hosted.tailoring (V3B S1 Task 5b).

The hosted tailor-run worker: claim -> materialize profile -> gate budget/BYO
-> 5 LLM calls (archetype/resume/latex/cover/attribution) -> verify claims
(pure) -> drop + re-render -> upload 6 objects -> mark succeeded/failed. Also
covers the zero-LLM `mode=render` short-circuit.

Fakes throughout, matching `tests/test_hosted_fanout.py`'s house style:
- `jobify.db`'s individual functions are monkeypatched directly (a tiny
  `_RunStore` fake stands in for the `tailor_runs` row + ledger, rather than
  a full fake Supabase client — this module never touches `db.client`
  directly, only the named helper functions).
- `jobify.shared.llm.complete_with_usage` is monkeypatched with a dispatcher
  that inspects the per-call task prompt's own heading (e.g. "# Classify
  Archetype") to return the right canned response for each of the 5 call
  sites — mirroring `test_hosted_fanout.py::_fixed_verdict_llm`'s pattern.
- `jobify.hosted.tailoring.materialize_profile_dir` is monkeypatched to
  return a `tmp_profile()`-built directory (same seam
  `test_hosted_fanout.py` uses for the exact same reason: the real
  `materialize_profile_dir(user_id)` reads Supabase, which we don't have
  here).
- `jobify.shared.storage.upload_bytes` / `.download_bytes` are monkeypatched
  onto an in-memory dict so no real Supabase Storage is touched.
- `tailor.latex_resume._compile_and_count_factory` is monkeypatched to a
  canned success/failure compile step (no real pdflatex dependency),
  matching `tests/test_latex_onepage.py`'s own "inject the compile step"
  convention.

Fixture profile: `tests/fixtures/profile/` (via the shared `tmp_profile`
fixture) already ships `profile.yml` with an `archetypes: test_lane: ...`
block and `identity:` — this suite overrides `cv.md` / `article-digest.md`
with a small "Alex Quinn"-style fixture using the REAL hosted
`## Confirmed metrics` / `## Never use` heading format (not
`profile.example/`'s legacy headings — matching Task 2's test conventions).
"""

from __future__ import annotations

import json

import pytest

from jobify import db
from jobify.hosted import tailoring
from jobify.shared import llm
from jobify.shared import storage as storage_mod
from jobify.shared.llm import CompletionUsage
from tailor import latex_resume as latex_mod  # bare, post-bootstrap (tailoring's own import ran it)

# ── Fixture profile-doc content ──────────────────────────────────────────────

CV_MD = """# CV

## Technical Skills
- Python, Go, Kubernetes

## Experience

Acme Corp -- Senior Engineer
Atlanta, GA | 2021--Present

- Cut inference latency from 2.1s to 380ms on Jetson Orin
- Led a team of 4 engineers shipping the platform rewrite

## Education

State University -- BS Computer Science (2016--2020)
"""

ARTICLE_DIGEST_MD = """## Confirmed metrics

- Cut inference latency from 2.1s to 380ms on Jetson Orin (from cv.md)

## Never use

- 100x
"""

_LATENCY_QUOTE = "Cut inference latency from 2.1s to 380ms on Jetson Orin"
_TEAM_QUOTE = "Led a team of 4 engineers shipping the platform rewrite"


def _latex_response(fabricate: bool = False) -> str:
    """Canned `tailor_latex_resume` JSON response. ``fabricate=True`` adds
    a third bullet citing a real cv.md span but asserting a number
    ("999999") that appears nowhere in that span or in the confirmed-
    metrics section — the deliberately-fabricated-metric drop-path case.
    """
    bullets = [_LATENCY_QUOTE, _TEAM_QUOTE]
    bullet_sources = [
        [{"file": "cv.md", "quote": _LATENCY_QUOTE}],
        [{"file": "cv.md", "quote": _TEAM_QUOTE}],
    ]
    if fabricate:
        bullets.append("Scaled the service to 999999 requests per second")
        bullet_sources.append([{"file": "cv.md", "quote": _LATENCY_QUOTE}])
    payload = {
        "skills": {"Core": "Python, Kubernetes"},
        "skills_sources": {"Core": [{"file": "cv.md", "quote": "Python, Go, Kubernetes"}]},
        "skills_layout": "auto",
        "experience": [
            {
                "org": "Acme Corp",
                "title": "Senior Engineer",
                "location": "Atlanta, GA",
                "period": "2021--Present",
                "projects": [
                    {
                        "name": "Platform Rewrite",
                        "period": "2021--Present",
                        "bullets": bullets,
                        "bullet_sources": bullet_sources,
                    }
                ],
            }
        ],
        "education": [
            {"school": "State University", "degree": "BS Computer Science", "period": "2016--2020"}
        ],
        "summary_line": None,
        "summary_sources": [],
    }
    return json.dumps(payload)


_ARCHETYPE_RESPONSE = json.dumps({"archetype": "test_lane", "confidence": 0.9, "reasoning": "fits"})
_RESUME_RESPONSE = json.dumps({
    "tailored_summary": "summary", "emphasis_areas": [], "keywords_to_include": [],
    "experience_order": [], "suggested_bullets": {}, "skills_section": {}, "diff_notes": "",
})
_COVER_LETTER_TEXT = (
    "I cut inference latency from 2.1s to 380ms on Jetson Orin at my current role. "
    "I'm excited about this opportunity because it aligns with my background."
)
# Note: deliberately no company-name mention here — a bare "Hi <Company> team,"
# would introduce a capitalized entity (the target company) with no citable
# cv.md source, which the verifier correctly flags as `new_entity` (rule 2).
# That's real, intended verifier behavior (see jobify/tailor/claims.py), not
# something these fixtures are meant to probe — kept the canned letter to
# claims that resolve cleanly against cv.md so the happy-path test's
# `dropped_count == 0` expectation reflects ONLY resume-side verification.
_ATTRIBUTION_RESPONSE = json.dumps({
    "units": [
        {
            "id": "cl.s0", "kind": "cl_sentence",
            "text": "I cut inference latency from 2.1s to 380ms on Jetson Orin at my current role.",
            "sources": [{"file": "cv.md", "quote": _LATENCY_QUOTE}],
        },
        {
            "id": "cl.s1", "kind": "voice",
            "text": "I'm excited about this opportunity because it aligns with my background.",
            "sources": [],
        },
    ]
})


def _make_fake_llm(latex_response: str):
    """Dispatcher fake for `llm.complete_with_usage` — routes on the
    per-call task prompt's own distinguishing heading line."""
    calls: list[dict] = []

    def _fake(*, system, prompt, model, max_tokens, api_key=None):
        calls.append({"prompt": prompt, "model": model, "api_key": api_key})
        if "# Classify Archetype" in prompt:
            text = _ARCHETYPE_RESPONSE
        elif "# Tailor Resume" in prompt:
            text = _RESUME_RESPONSE
        elif "# Tailor LaTeX Resume" in prompt:
            text = latex_response
        elif "# Generate Cover Letter" in prompt:
            text = _COVER_LETTER_TEXT
        elif "# Attribute Claims" in prompt:
            text = _ATTRIBUTION_RESPONSE
        else:
            raise AssertionError(f"unrecognized prompt in fake llm: {prompt[:120]!r}")
        return text, CompletionUsage(input_tokens=100, output_tokens=50)

    return _fake, calls


def _fake_compile_ok(td_path, safe_company):
    def _run(latex: str):
        return (True, 1, b"%PDF-FAKE", "")
    return _run


def _fake_compile_fail(td_path, safe_company):
    def _run(latex: str):
        return (False, None, None, "fake pdflatex failure")
    return _run


def _posting(pid: str = "posting-1", **kw) -> dict:
    base = {
        "id": pid,
        "title": "Platform Engineer",
        "company": "Acme",
        "location": "Remote",
        "description": "Own services end to end.",
        "application_url": "https://acme.example/apply",
    }
    base.update(kw)
    return base


class _RunStore:
    """Tiny fake for the `tailor_runs` row + ledger lifecycle, monkeypatched
    onto `jobify.db`'s individual functions (matching
    `test_hosted_fanout.py`'s direct-monkeypatch style)."""

    def __init__(self, run: dict):
        self.run = dict(run)
        self.progress: list[dict] = list(run.get("progress") or [])
        self.ledger_rows: list[dict] = []
        self.succeeded_args: dict | None = None
        self.failed_error: str | None = None

    def install(self, monkeypatch):
        monkeypatch.setattr(db, "get_tailor_run", lambda run_id: dict(self.run, progress=list(self.progress)))

        def _mark_running(run_id):
            self.run["status"] = "running"
        monkeypatch.setattr(db, "mark_tailor_run_running", _mark_running)

        def _append_progress(run_id, step, label):
            self.progress.append({"step": step, "label": label, "at": "2026-01-01T00:00:00Z"})
        monkeypatch.setattr(db, "append_tailor_run_progress", _append_progress)

        def _insert_ledger(user_id, event, *, model=None, input_tokens=0, output_tokens=0,
                            cost_usd=0.0, run_id=None, byo=False):
            self.ledger_rows.append({
                "user_id": user_id, "event": event, "model": model,
                "input_tokens": input_tokens, "output_tokens": output_tokens,
                "cost_usd": cost_usd, "run_id": run_id, "byo": byo,
            })
        monkeypatch.setattr(db, "insert_budget_ledger_row", _insert_ledger)

        def _mark_succeeded(run_id, *, dropped_count, cost_usd, doc_sha256):
            self.succeeded_args = {
                "dropped_count": dropped_count, "cost_usd": cost_usd, "doc_sha256": doc_sha256,
            }
            self.run["status"] = "succeeded"
        monkeypatch.setattr(db, "mark_tailor_run_succeeded", _mark_succeeded)

        def _mark_failed(run_id, error):
            self.failed_error = error
            self.run["status"] = "failed"
        monkeypatch.setattr(db, "mark_tailor_run_failed", _mark_failed)


class _FakeStorage:
    """In-memory stand-in for `jobify.shared.storage`'s upload/download."""

    def __init__(self, seed: dict[str, bytes] | None = None):
        self.objects: dict[str, bytes] = dict(seed or {})
        self.uploads: list[tuple[str, bytes, str]] = []

    def install(self, monkeypatch):
        def _upload(path, data, content_type):
            self.objects[path] = data
            self.uploads.append((path, data, content_type))
        monkeypatch.setattr(storage_mod, "upload_bytes", _upload)
        monkeypatch.setattr(storage_mod, "download_bytes", lambda path: self.objects[path])


@pytest.fixture(autouse=True)
def _budget_ok_by_default(monkeypatch):
    monkeypatch.setattr(db, "get_api_key_ciphertext", lambda uid: None)
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "get_global_month_to_date_spend", lambda: 0.0)


def _install_common(tmp_profile, monkeypatch, *, posting=None):
    d = tmp_profile(overrides={"cv.md": CV_MD, "article-digest.md": ARTICLE_DIGEST_MD})
    monkeypatch.setattr(tailoring, "materialize_profile_dir", lambda user_id: d)
    monkeypatch.setattr(db, "get_postings_by_ids", lambda ids: [posting or _posting()])
    monkeypatch.setattr(latex_mod, "_compile_and_count_factory", _fake_compile_ok)
    return d


# ── Happy path ────────────────────────────────────────────────────────────


def test_happy_path_succeeds_with_five_ledger_rows_and_six_objects(tmp_profile, monkeypatch):
    _install_common(tmp_profile, monkeypatch)
    fake_llm, calls = _make_fake_llm(_latex_response(fabricate=False))
    monkeypatch.setattr(llm, "complete_with_usage", fake_llm)

    run_store = _RunStore({
        "id": "run-1", "user_id": "user-1", "posting_id": "posting-1",
        "mode": "tailor", "status": "queued", "template": None, "progress": [],
    })
    run_store.install(monkeypatch)
    fake_storage = _FakeStorage()
    fake_storage.install(monkeypatch)

    tailoring._execute("run-1")

    assert run_store.run["status"] == "succeeded"
    assert len(calls) == 5

    assert len(run_store.ledger_rows) == 5
    assert {r["event"] for r in run_store.ledger_rows} == {
        "tailor_archetype", "tailor_resume", "tailor_latex", "tailor_cover", "tailor_claims",
    }
    assert all(r["run_id"] == "run-1" for r in run_store.ledger_rows)
    assert all(r["byo"] is False for r in run_store.ledger_rows)

    assert run_store.succeeded_args["dropped_count"] == 0
    assert run_store.succeeded_args["cost_usd"] > 0
    assert run_store.succeeded_args["doc_sha256"]

    uploaded_paths = {p for p, _b, _c in fake_storage.uploads}
    assert uploaded_paths == {
        "user-1/posting-1/resume.pdf",
        "user-1/posting-1/cover_letter.pdf",
        "user-1/posting-1/cover_letter.txt",
        "user-1/posting-1/tailored.json",
        "user-1/posting-1/claims.json",
        "user-1/posting-1/render_meta.json",
    }

    claims_data = json.loads(fake_storage.objects["user-1/posting-1/claims.json"])
    assert claims_data["version"] == 1
    assert claims_data["dropped"] == []
    assert claims_data["doc_sha256"] == run_store.succeeded_args["doc_sha256"]
    assert len(claims_data["units"]) > 0

    tailored_json = json.loads(fake_storage.objects["user-1/posting-1/tailored.json"])
    assert tailored_json["experience"][0]["org"] == "Acme Corp"


# ── Drop path (deliberately fabricated metric) ───────────────────────────


def test_drop_path_removes_fabricated_metric(tmp_profile, monkeypatch):
    _install_common(tmp_profile, monkeypatch)
    fake_llm, _calls = _make_fake_llm(_latex_response(fabricate=True))
    monkeypatch.setattr(llm, "complete_with_usage", fake_llm)

    run_store = _RunStore({
        "id": "run-2", "user_id": "user-2", "posting_id": "posting-1",
        "mode": "tailor", "status": "queued", "template": None, "progress": [],
    })
    run_store.install(monkeypatch)
    fake_storage = _FakeStorage()
    fake_storage.install(monkeypatch)

    tailoring._execute("run-2")

    assert run_store.run["status"] == "succeeded"
    assert run_store.succeeded_args["dropped_count"] == 1

    claims_data = json.loads(fake_storage.objects["user-2/posting-1/claims.json"])
    assert len(claims_data["dropped"]) == 1
    dropped = claims_data["dropped"][0]
    assert dropped["id"] == "r.exp0.b2"  # third bullet, 0-based index 2
    assert dropped["reason"] == "number_not_confirmed"

    tailored_json = json.loads(fake_storage.objects["user-2/posting-1/tailored.json"])
    all_bullet_text = " ".join(
        b
        for exp in tailored_json["experience"]
        for proj in exp["projects"]
        for b in proj["bullets"]
    )
    assert "999999" not in all_bullet_text

    # the LaTeX source underlying the rendered PDF must not carry the
    # fabricated bullet either — assert against the fake compile step's
    # captured latex text via the tailored_data upload (the PDF bytes
    # themselves are opaque bytes in this fake).
    assert "999999" not in json.dumps(tailored_json)


# ── Failure path ───────────────────────────────────────────────────────────


def test_failure_path_marks_run_failed(tmp_profile, monkeypatch):
    _install_common(tmp_profile, monkeypatch)

    def _fake(*, system, prompt, model, max_tokens, api_key=None):
        if "# Classify Archetype" in prompt:
            return _ARCHETYPE_RESPONSE, CompletionUsage(input_tokens=100, output_tokens=50)
        if "# Tailor Resume" in prompt:
            return "this is not valid json", CompletionUsage(input_tokens=100, output_tokens=50)
        raise AssertionError(f"should not reach this call site: {prompt[:80]!r}")

    monkeypatch.setattr(llm, "complete_with_usage", _fake)

    run_store = _RunStore({
        "id": "run-3", "user_id": "user-3", "posting_id": "posting-1",
        "mode": "tailor", "status": "queued", "template": None, "progress": [],
    })
    run_store.install(monkeypatch)
    fake_storage = _FakeStorage()
    fake_storage.install(monkeypatch)

    with pytest.raises(Exception):
        tailoring._execute("run-3")

    assert run_store.run["status"] == "failed"
    assert run_store.failed_error
    # the malformed resume response means no material was ever uploaded
    assert fake_storage.uploads == []


def test_failure_path_latex_compile_failure_marks_run_failed(tmp_profile, monkeypatch):
    _install_common(tmp_profile, monkeypatch)
    monkeypatch.setattr(latex_mod, "_compile_and_count_factory", _fake_compile_fail)
    fake_llm, _calls = _make_fake_llm(_latex_response(fabricate=False))
    monkeypatch.setattr(llm, "complete_with_usage", fake_llm)

    run_store = _RunStore({
        "id": "run-3b", "user_id": "user-3b", "posting_id": "posting-1",
        "mode": "tailor", "status": "queued", "template": None, "progress": [],
    })
    run_store.install(monkeypatch)
    fake_storage = _FakeStorage()
    fake_storage.install(monkeypatch)

    with pytest.raises(RuntimeError, match="LaTeX compile failed"):
        tailoring._execute("run-3b")

    assert run_store.run["status"] == "failed"
    assert "LaTeX compile failed" in run_store.failed_error


# ── mode=render short-circuit ─────────────────────────────────────────────


def test_render_mode_is_zero_llm_and_zero_ledger(tmp_profile, monkeypatch):
    d = tmp_profile(overrides={"cv.md": CV_MD, "article-digest.md": ARTICLE_DIGEST_MD})
    monkeypatch.setattr(tailoring, "materialize_profile_dir", lambda user_id: d)
    monkeypatch.setattr(db, "get_postings_by_ids", lambda ids: [_posting()])
    monkeypatch.setattr(latex_mod, "_compile_and_count_factory", _fake_compile_ok)

    def _boom_llm(**kwargs):
        raise AssertionError("mode=render must never call the LLM")
    monkeypatch.setattr(llm, "complete_with_usage", _boom_llm)

    seed_tailored = {
        "skills": {"Core": "Python, Kubernetes"},
        "skills_layout": "auto",
        "experience": [
            {
                "org": "Acme Corp", "title": "Senior Engineer", "location": "Atlanta, GA",
                "period": "2021--Present",
                "projects": [
                    {"name": "Platform Rewrite", "period": "2021--Present", "bullets": [_LATENCY_QUOTE]}
                ],
            }
        ],
        "education": [
            {"school": "State University", "degree": "BS Computer Science", "period": "2016--2020"}
        ],
        "summary_line": None,
    }
    seed_claims = {
        "version": 1, "doc_sha256": "abc123deadbeef",
        "units": [{"id": "r.exp0.header", "surface": "resume", "kind": "header", "status": "verified"}],
        "dropped": [{"id": "r.exp0.b9", "text": "dropped one", "reason": "number_not_confirmed"}],
    }
    seed = {
        "user-4/posting-1/tailored.json": json.dumps(seed_tailored).encode("utf-8"),
        "user-4/posting-1/claims.json": json.dumps(seed_claims).encode("utf-8"),
        "user-4/posting-1/render_meta.json": json.dumps({"style": "classic", "pages": 1}).encode("utf-8"),
        "user-4/posting-1/cover_letter.txt": "Hi Acme team, thanks for your consideration.".encode("utf-8"),
    }
    fake_storage = _FakeStorage(seed=seed)
    fake_storage.install(monkeypatch)

    run_store = _RunStore({
        "id": "run-4", "user_id": "user-4", "posting_id": "posting-1",
        "mode": "render", "status": "queued", "template": None, "progress": [],
    })
    run_store.install(monkeypatch)

    tailoring._execute("run-4")

    assert run_store.run["status"] == "succeeded"
    assert run_store.ledger_rows == []  # zero budget_ledger rows
    assert run_store.succeeded_args["cost_usd"] == 0.0
    assert run_store.succeeded_args["dropped_count"] == 1
    assert run_store.succeeded_args["doc_sha256"] == "abc123deadbeef"

    uploaded_paths = {p for p, _b, _c in fake_storage.uploads}
    assert uploaded_paths == {
        "user-4/posting-1/resume.pdf",
        "user-4/posting-1/cover_letter.pdf",
        "user-4/posting-1/cover_letter.txt",
        "user-4/posting-1/tailored.json",
        "user-4/posting-1/claims.json",
        "user-4/posting-1/render_meta.json",
    }
    # claims.json is re-uploaded UNCHANGED (nothing re-verified in render mode)
    assert json.loads(fake_storage.objects["user-4/posting-1/claims.json"]) == seed_claims


def test_render_mode_honors_explicit_template_override(tmp_profile, monkeypatch):
    d = tmp_profile(overrides={"cv.md": CV_MD, "article-digest.md": ARTICLE_DIGEST_MD})
    monkeypatch.setattr(tailoring, "materialize_profile_dir", lambda user_id: d)
    monkeypatch.setattr(db, "get_postings_by_ids", lambda ids: [_posting()])

    captured_styles: list[str] = []

    def _capture_compile(tailored, style, compile_and_count):
        captured_styles.append(style)
        return {
            "latex_source": "x", "pdf_bytes": b"%PDF-FAKE", "compile_success": True,
            "compile_log": "", "pages": 1, "trim_iterations": 0, "tailored_data": tailored,
        }
    monkeypatch.setattr(latex_mod, "_fit_to_one_page", _capture_compile)

    def _boom_llm(**kwargs):
        raise AssertionError("mode=render must never call the LLM")
    monkeypatch.setattr(llm, "complete_with_usage", _boom_llm)

    seed_tailored = {"skills": {}, "experience": [], "education": [], "summary_line": None}
    seed_claims = {"version": 1, "doc_sha256": "xyz", "units": [], "dropped": []}
    seed = {
        "user-5/posting-1/tailored.json": json.dumps(seed_tailored).encode("utf-8"),
        "user-5/posting-1/claims.json": json.dumps(seed_claims).encode("utf-8"),
        "user-5/posting-1/render_meta.json": json.dumps({"style": "classic", "pages": 1}).encode("utf-8"),
        "user-5/posting-1/cover_letter.txt": "Hi team, thanks.".encode("utf-8"),
    }
    fake_storage = _FakeStorage(seed=seed)
    fake_storage.install(monkeypatch)

    run_store = _RunStore({
        "id": "run-5", "user_id": "user-5", "posting_id": "posting-1",
        "mode": "render", "status": "queued", "template": "modern", "progress": [],
    })
    run_store.install(monkeypatch)

    tailoring._execute("run-5")

    assert run_store.run["status"] == "succeeded"
    assert captured_styles == ["modern"]
    render_meta = json.loads(fake_storage.objects["user-5/posting-1/render_meta.json"])
    assert render_meta["style"] == "modern"


# ── Progress + budget gate ─────────────────────────────────────────────────


def test_tailor_mode_appends_the_six_progress_stage_labels_in_order(tmp_profile, monkeypatch):
    _install_common(tmp_profile, monkeypatch)
    fake_llm, _calls = _make_fake_llm(_latex_response(fabricate=False))
    monkeypatch.setattr(llm, "complete_with_usage", fake_llm)

    run_store = _RunStore({
        "id": "run-6", "user_id": "user-6", "posting_id": "posting-1",
        "mode": "tailor", "status": "queued", "template": None, "progress": [],
    })
    run_store.install(monkeypatch)
    fake_storage = _FakeStorage()
    fake_storage.install(monkeypatch)

    tailoring._execute("run-6")

    labels = [p["label"] for p in run_store.progress]
    assert labels == [
        "reading your profile",
        "choosing the frame",
        "drafting the resume",
        "writing the cover letter",
        "checking every claim against your profile",
        "rendering PDFs",
    ]


def test_budget_cap_reached_marks_failed_without_spending(tmp_profile, monkeypatch):
    _install_common(tmp_profile, monkeypatch)
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 100.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 5.0)

    def _boom_llm(**kwargs):
        raise AssertionError("budget-capped run must never call the LLM")
    monkeypatch.setattr(llm, "complete_with_usage", _boom_llm)

    run_store = _RunStore({
        "id": "run-7", "user_id": "user-7", "posting_id": "posting-1",
        "mode": "tailor", "status": "queued", "template": None, "progress": [],
    })
    run_store.install(monkeypatch)
    fake_storage = _FakeStorage()
    fake_storage.install(monkeypatch)

    tailoring._execute("run-7")  # returns cleanly, does not raise

    assert run_store.run["status"] == "failed"
    assert "budget" in run_store.failed_error.lower()
    assert run_store.ledger_rows == []
    assert fake_storage.uploads == []


# ── Claim-run: missing row is a caller error ───────────────────────────────


def test_execute_raises_when_run_row_missing(monkeypatch):
    monkeypatch.setattr(db, "get_tailor_run", lambda run_id: None)
    marked_failed = []
    monkeypatch.setattr(db, "mark_tailor_run_failed", lambda run_id, error: marked_failed.append(run_id))

    with pytest.raises(RuntimeError, match="not found"):
        tailoring._execute("nonexistent-run")

    # no row to mark failed against — this is a caller error, not a run failure
    assert marked_failed == []


# ── Console script ─────────────────────────────────────────────────────────


def test_run_parses_run_flag_and_executes(monkeypatch):
    captured = []
    monkeypatch.setattr(tailoring, "_execute", lambda run_id: captured.append(run_id))
    monkeypatch.setattr("sys.argv", ["jobify-hosted-tailor", "--run", "run-123"])

    tailoring.run()

    assert captured == ["run-123"]
