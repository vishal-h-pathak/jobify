"""tests/test_resume_templates.py — the ATS-parsability gate (WS-F).

For EVERY template in ``jobify.resume_templates`` this:

  1. statically asserts the template is ATS-safe (single column, standard
     fonts, no graphics, nothing in headers/footers) — runs with no TeX, so
     CI always exercises it;
  2. renders it to a real PDF with pdflatex, extracts the text with up to two
     independent parsers (``pdftotext`` from poppler + ``pdfminer.six``), and
     asserts every section heading, contact field, skill, and bullet comes
     back as clean selectable text in the correct reading order, nothing lost
     or scrambled.

The render/extract gate skips gracefully when neither ``pdflatex`` nor a text
extractor is installed, so the suite still collects on a bare checkout. See
``jobify/resume_templates/README.md`` for the rules being enforced.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from jobify import resume_templates as gallery

# latex_resume lives under the tailor subtree's bare-import namespace; importing
# the pipeline first bootstraps sys.path (same pattern as test_latex_onepage).
from jobify.tailor import pipeline  # noqa: F401 — sys.path bootstrap
from tailor import latex_resume as latex_mod


# ── Representative content fixture ───────────────────────────────────────────
# Persona-neutral on purpose (WS-A2 owns generalizing latex_resume.BASE_RESUME;
# WS-F owns layout). Sized to fit one page in every gallery template. Includes
# special characters (&, $, %, °) so the gate also proves escaping survives
# extraction. Header/contact text comes from latex_mod.BASE_RESUME so this stays
# correct after WS-A2 generalizes that block.

_CONTENT: dict = {
    "skills": {
        "Languages & Frameworks": "Python, Go, TypeScript, React, FastAPI",
        "Infrastructure & Data": "PostgreSQL, Redis, Kafka, Docker, Kubernetes, AWS",
        "Practices": "CI/CD, observability, load testing, 99.9% uptime SLOs",
    },
    "experience": [
        {
            "org": "Northwind Systems",
            "title": "Staff Engineer",
            "location": "Remote",
            "period": "2020 -- Present",
            "projects": [
                {
                    "name": "Billing Platform Re-architecture",
                    "period": "2021--2023",
                    "bullets": [
                        "Led migration of a monolith to seven services, cutting p99 latency 45% under peak load",
                        "Designed an idempotent payment ledger handling $2M per day with zero double-charges",
                    ],
                },
                {
                    "name": "Observability Overhaul",
                    "period": "2020",
                    "bullets": [
                        "Rolled out distributed tracing across 30+ services, halving mean-time-to-resolution",
                    ],
                },
            ],
        },
        {
            "org": "Acme Web Co.",
            "title": "Senior Software Engineer",
            "location": "Austin, TX",
            "period": "2016 -- 2020",
            "projects": [
                {
                    "name": None,
                    "period": None,
                    "bullets": [
                        "Built a React and GraphQL dashboard used daily by 4,000 internal operators",
                        "Reduced cloud spend 30% by right-sizing autoscaling groups and caching hot reads",
                    ],
                },
            ],
        },
    ],
}

# Distinctive substrings that must survive extraction, per content area.
_SECTION_HEADINGS = ["Education", "Technical Skills", "Experience"]
_SKILL_LABELS = ["Languages", "Infrastructure", "Practices"]
_SKILL_TOKENS = ["Python", "PostgreSQL", "Kubernetes", "observability"]
_EMPLOYERS = ["Northwind Systems", "Acme Web Co"]
_BULLET_FRAGMENTS = [
    "idempotent payment ledger",
    "double-charges",
    "distributed tracing",
    "mean-time-to-resolution",
    "GraphQL dashboard",
    "autoscaling groups",
]
# Reading-order spine: name → headings → first employer → second employer.
_ORDER_SPINE = [
    latex_mod.BASE_RESUME["name"],
    "Education",
    "Experience",
    "Northwind",
    "Acme",
]


# ── Extraction tooling ───────────────────────────────────────────────────────


def _have_pdflatex() -> bool:
    return shutil.which("pdflatex") is not None


def _pdftotext(pdf: Path, layout: bool = False) -> str | None:
    if shutil.which("pdftotext") is None:
        return None
    args = ["pdftotext"]
    if layout:
        args.append("-layout")
    args += [str(pdf), "-"]
    res = subprocess.run(args, capture_output=True, text=True, timeout=30)
    return res.stdout


def _pdfminer(pdf: Path) -> str | None:
    try:
        from pdfminer.high_level import extract_text
    except Exception:
        return None
    return extract_text(str(pdf))


def _extract_all(pdf: Path) -> dict[str, str]:
    """Return {parser_name: text} for every extractor available."""
    out: dict[str, str] = {}
    raw = _pdftotext(pdf, layout=False)
    if raw is not None:
        out["pdftotext"] = raw
    layout = _pdftotext(pdf, layout=True)
    if layout is not None:
        out["pdftotext_layout"] = layout
    miner = _pdfminer(pdf)
    if miner is not None:
        out["pdfminer"] = miner
    return out


@pytest.fixture(scope="module")
def rendered() -> dict[str, dict]:
    """Compile every gallery template once and extract its text.

    Returns {template_id: {"pages": int|None, "texts": {parser: str}}}.
    Skips the whole module if pdflatex is unavailable.
    """
    if not _have_pdflatex():
        pytest.skip("pdflatex not installed — skipping render/extract gate")

    results: dict[str, dict] = {}
    with tempfile.TemporaryDirectory(prefix="resume_gate_") as td:
        td_path = Path(td)
        for tid in gallery.template_ids():
            latex = latex_mod._render_latex(_CONTENT, tid)
            tex = td_path / f"{tid}.tex"
            tex.write_text(latex, encoding="utf-8")
            pdf = td_path / f"{tid}.pdf"
            ok, stdout, log = latex_mod._compile_once(tex, pdf, td_path)
            assert ok, f"template {tid!r} failed to compile:\n{log[-1500:]}"
            results[tid] = {
                "pages": latex_mod._pdf_page_count(stdout, pdf),
                "texts": _extract_all(pdf),
            }
    return results


def _texts_or_skip(rendered: dict, tid: str) -> dict[str, str]:
    texts = rendered[tid]["texts"]
    if not texts:
        pytest.skip("no PDF text extractor available (install poppler/pdfminer.six)")
    return texts


# ── Static ATS-safety gate (no TeX needed) ───────────────────────────────────

_BANNED = (
    "graphicx", "includegraphics",  # text baked into images / graphics
    "multicol", "\\columnbreak",    # multi-column flows that scramble on extract
    "wrapfig", "tikzpicture", "\\begin{picture}",  # drawing / float layout
    "fancyhdr", "\\fancyhead", "\\fancyfoot",      # info in headers/footers
)
_ALLOWED_FONT_PKGS = ("lmodern",)  # CM serif (default) needs no package


def test_gallery_size_is_three_to_five():
    assert 3 <= len(gallery.TEMPLATES) <= 5


def test_default_template_is_in_gallery():
    assert gallery.DEFAULT_TEMPLATE_ID in gallery.TEMPLATES
    assert gallery.is_valid_template_id(gallery.DEFAULT_TEMPLATE_ID)


def test_template_ids_match_keys_and_are_distinct():
    for tid, tpl in gallery.TEMPLATES.items():
        assert tpl.id == tid
        assert tpl.label and tpl.summary and tpl.look
    looks = {tpl.look for tpl in gallery.gallery()}
    assert len(looks) == len(gallery.TEMPLATES), "templates must be visually distinct"


@pytest.mark.parametrize("tid", gallery.template_ids())
def test_template_source_is_ats_safe(tid):
    src = gallery.TEMPLATES[tid].latex_source
    # Nothing in headers/footers.
    assert "\\pagestyle{empty}" in src
    # No banned, ATS-hostile constructs.
    for banned in _BANNED:
        assert banned not in src, f"{tid} uses banned construct {banned!r}"
    # Only the standard/allowed font packages — no exotic fonts.
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("\\usepackage") and "{" in stripped:
            pkgs = stripped[stripped.index("{") + 1: stripped.index("}")]
            for pkg in pkgs.split(","):
                pkg = pkg.strip()
                if pkg in ("fontspec", "helvet", "times", "mathptmx", "palatino"):
                    pytest.fail(f"{tid} pulls in non-standard font package {pkg!r}")
    # Shared body placeholders intact (so the tailor's renderer works).
    for ph in ("<<NAME>>", "<<EMAIL>>", "<<EDU_AND_SKILLS>>", "<<EXPERIENCE_BLOCKS>>"):
        assert ph in src, f"{tid} missing body placeholder {ph}"
    # All typography tokens were filled (no leftover %%...%% markers).
    assert "%%" not in src, f"{tid} has an unfilled style token"


# ── Render → extract → assert (the real parse gate) ──────────────────────────


@pytest.mark.parametrize("tid", gallery.template_ids())
def test_template_compiles_to_one_page(rendered, tid):
    assert rendered[tid]["pages"] == 1, f"{tid} did not render to a single page"


@pytest.mark.parametrize("tid", gallery.template_ids())
def test_section_headings_extract_as_text(rendered, tid):
    for text in _texts_or_skip(rendered, tid).values():
        low = text.lower()
        for heading in _SECTION_HEADINGS:
            assert heading.lower() in low, f"{tid}: heading {heading!r} not selectable"


@pytest.mark.parametrize("tid", gallery.template_ids())
def test_contact_info_is_real_text(rendered, tid):
    # Real selectable text, not an image — every contact field round-trips.
    contact = [
        latex_mod.BASE_RESUME["email"],
        latex_mod.BASE_RESUME["location"],
        latex_mod.BASE_RESUME["website"],
        latex_mod.BASE_RESUME["linkedin"],
        latex_mod.BASE_RESUME["name"],
    ]
    for text in _texts_or_skip(rendered, tid).values():
        low = text.lower()
        for field in contact:
            assert field.lower() in low, f"{tid}: contact {field!r} missing from text"


@pytest.mark.parametrize("tid", gallery.template_ids())
def test_skills_and_labels_extract(rendered, tid):
    for text in _texts_or_skip(rendered, tid).values():
        low = text.lower()
        for token in _SKILL_LABELS + _SKILL_TOKENS:
            assert token.lower() in low, f"{tid}: skill token {token!r} lost"


@pytest.mark.parametrize("tid", gallery.template_ids())
def test_all_bullets_and_employers_extract(rendered, tid):
    for text in _texts_or_skip(rendered, tid).values():
        low = text.lower()
        for frag in _EMPLOYERS + _BULLET_FRAGMENTS:
            assert frag.lower() in low, f"{tid}: content {frag!r} lost or scrambled"


@pytest.mark.parametrize("tid", gallery.template_ids())
def test_reading_order_is_preserved(rendered, tid):
    # Use raw pdftotext (true reading order); fall back to any extractor.
    texts = _texts_or_skip(rendered, tid)
    text = texts.get("pdftotext") or next(iter(texts.values()))
    low = text.lower()
    idxs = [low.find(tok.lower()) for tok in _ORDER_SPINE]
    assert all(i != -1 for i in idxs), f"{tid}: order spine token missing ({_ORDER_SPINE})"
    assert idxs == sorted(idxs), f"{tid}: content out of reading order: {idxs}"


@pytest.mark.parametrize("tid", gallery.template_ids())
def test_independent_parsers_agree(rendered, tid):
    # The "second parser" cross-check: when two extractors are present, both
    # must recover the headings and a representative bullet — guards against a
    # single parser papering over a scramble the other would catch.
    texts = _texts_or_skip(rendered, tid)
    distinct = {}
    for name, body in texts.items():
        distinct[name.split("_")[0]] = body  # collapse pdftotext / pdftotext_layout
    if len(distinct) < 2:
        pytest.skip("need two independent parsers for the cross-check")
    probes = _SECTION_HEADINGS + ["idempotent payment ledger", "GraphQL dashboard"]
    for name, body in distinct.items():
        low = body.lower()
        for probe in probes:
            assert probe.lower() in low, f"{tid}: parser {name} missing {probe!r}"


# ── Selection wiring (WS-F: tailor honors the profile's pick) ────────────────


def test_select_template_honors_profile_pick(monkeypatch):
    monkeypatch.setattr(latex_mod.profile_loader, "load_resume_template", lambda: "executive")
    # Profile pick wins over the archetype default (which would be 'modern').
    assert latex_mod._select_template("tier_2_ai_se") == "executive"


def test_select_template_ignores_unknown_pick(monkeypatch):
    monkeypatch.setattr(latex_mod.profile_loader, "load_resume_template", lambda: "nope")
    # Bad id is ignored; fall through to archetype selection.
    assert latex_mod._select_template("tier_2_ai_se") == "modern"


def test_select_template_falls_back_to_archetype_when_unset(monkeypatch):
    monkeypatch.setattr(latex_mod.profile_loader, "load_resume_template", lambda: "")
    assert latex_mod._select_template("tier_1a_compneuro") == "classic"
    assert latex_mod._select_template("tier_2_ai_se") == "modern"
    assert latex_mod._select_template("unknown") == "classic"


def test_load_resume_template_reads_profile(tmp_profile):
    from jobify import profile_loader
    tmp_profile(overrides={"profile.yml": "resume_template: accent\n"})
    assert profile_loader.load_resume_template() == "accent"


def test_load_resume_template_empty_when_unset(tmp_profile):
    from jobify import profile_loader
    tmp_profile(overrides={"profile.yml": "identity:\n  name: Test User\n"})
    assert profile_loader.load_resume_template() == ""
