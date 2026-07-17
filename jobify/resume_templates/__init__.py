"""jobify.resume_templates — the ATS-safe one-page resume template gallery.

WS-F. A small catalog of visually distinct one-page LaTeX templates the user
picks from during onboarding (WS-E offers the pick; the chosen id is stored as
``resume_template`` in ``profile.yml`` and honored by the tailor). EVERY
template must survive ATS text extraction or it defeats the purpose, so the
gallery is built so ATS-safety is guaranteed *by construction*:

  * Every template is the SAME shared single-column skeleton (`BASE_TEMPLATE`)
    with only per-template *typography* tokens swapped in (`_apply_style`).
    Templates never restructure the body, so a template can't accidentally
    introduce a multi-column flow, a graphic, or header/footer content.
  * The header is identical and shared across all templates: one centered line
    of plain-text contact info. Fancy header layouts and info-in-headers are
    the #1 cause of ATS parse failures, so we deliberately do not vary it.

ATS rules every template obeys (enforced by ``tests/test_resume_templates.py``,
which renders each one, extracts the text with two independent parsers, and
asserts every heading / bullet / contact field round-trips as selectable text
in reading order):

  - single-column body — no ``multicol``, no ``\\columnbreak``
  - no graphics — no ``graphicx`` / ``\\includegraphics``; contact info is
    real text, never an image
  - standard, widely-installed fonts only (Computer Modern serif, Latin Modern
    Sans) — no exotic/missing fonts that would fail to embed or extract
  - nothing critical in headers/footers (``\\pagestyle{empty}``)
  - no color blocks behind text (colored *heading text* is fine — it still
    extracts as selectable text)

"Distinct look" therefore comes only from font family, section-heading
treatment (rule / no-rule / uppercase / color), name size, point size, and
spacing — never from layout that risks extraction.

This module is intentionally free of any dependency on
``jobify.tailor.latex_resume`` (latex_resume imports *this*): it owns the
catalog; latex_resume owns rendering + the one-page trim loop.
"""

from __future__ import annotations

from dataclasses import dataclass

# ── Shared ATS-safe skeleton ────────────────────────────────────────────────
#
# Carries the structure (header → education/skills → experience) and the
# defensive special-char macros. Per-template typography tokens (%%FONT%%,
# %%SECTION%%, %%TITLESPACE%%, %%LIST%%, %%PTSIZE%%, %%MARGIN%%, %%NAMESIZE%%)
# get filled by _apply_style; the rendered string for every template still uses
# the identical <<...>> body placeholders that jobify.tailor.latex_resume fills.

BASE_TEMPLATE = r"""
\documentclass[%%PTSIZE%%, letterpaper]{article}

\usepackage[T1]{fontenc}
\usepackage[margin=%%MARGIN%%]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage{hyperref}
\usepackage{xcolor}
\usepackage{textcomp}
%%FONT%%
% Defensive macros for special-character commands the LLM occasionally
% emits instead of the unicode literals it sees in BASE_RESUME (e.g.
% rewriting "360°" as "360\degree"). _escape_latex_safe deliberately
% lets backslash sequences pass through (since the template uses many
% legitimately), so an undefined macro would otherwise crash compile.
% \providecommand only defines if not already defined, so this is safe
% even when a future package upgrade ships its own \degree.
\providecommand{\degree}{\ensuremath{^\circ}}
\providecommand{\micro}{\ensuremath{\mu}}
\providecommand{\celsius}{\ensuremath{^\circ}C}
\providecommand{\ohm}{\ensuremath{\Omega}}

% ── Formatting ─────────────────────────────────────────────────────────────
\pagestyle{empty}
\setlength{\parindent}{0pt}
\definecolor{linkblue}{HTML}{2563EB}

\hypersetup{
    colorlinks=true,
    urlcolor=linkblue,
    linkcolor=linkblue,
}

%%SECTION%%
%%TITLESPACE%%

%%LIST%%

\begin{document}

% ── Header ─────────────────────────────────────────────────────────────────
% Shared across every template: ONE centered line of plain-text contact info.
% Never put contact info in a real header/footer or an image — both break ATS.
\begin{center}
{%%NAMESIZE%% \textbf{<<NAME>>}} \\[4pt]
\small <<CONTACT_LINE>>
\end{center}

% ── Education & Skills ─────────────────────────────────────────────────────
\section{Education \& Technical Skills}

<<EDU_AND_SKILLS>>

% ── Experience ─────────────────────────────────────────────────────────────
\section{Experience}

<<EXPERIENCE_BLOCKS>>

\end{document}
"""


def _apply_style(
    *, ptsize: str, margin: str, font: str, namesize: str,
    section: str, titlespace: str, listspace: str,
) -> str:
    """Fill the per-template typography tokens in BASE_TEMPLATE, leaving the
    <<...>> body placeholders for jobify.tailor.latex_resume._render_latex."""
    out = BASE_TEMPLATE
    out = out.replace("%%PTSIZE%%", ptsize)
    out = out.replace("%%MARGIN%%", margin)
    out = out.replace("%%FONT%%", font)
    out = out.replace("%%NAMESIZE%%", namesize)
    out = out.replace("%%SECTION%%", section)
    out = out.replace("%%TITLESPACE%%", titlespace)
    out = out.replace("%%LIST%%", listspace)
    return out


# Section-heading formats. All produce selectable heading text; they differ
# only in case-folding, color, and whether a hairline rule sits under the title.
_SECTION_RULE = (
    r"\titleformat{\section}{\large\bfseries\color{linkblue}}{}{0em}{}[\titlerule]"
)
_SECTION_NORULE_UPPER = (
    r"\titleformat{\section}{\large\bfseries\color{linkblue}}{}{0em}{\MakeUppercase}"
)
_SECTION_RULE_UPPER_BLACK = (
    r"\titleformat{\section}{\large\bfseries}{}{0em}{\MakeUppercase}[\titlerule]"
)

# Latin Modern Sans (lmodern, in texlive-latex-recommended) rather than
# helvet/Helvetica: the URW Helvetica TFMs aren't in every texlive set, and a
# missing-font compile failure would flip the row to needs_review. lmodern
# ships full T1 coverage, is ATS-safe (standard selectable text), and renders a
# clean professional sans.
_SANS_FONT = "\\usepackage{lmodern}\n\\renewcommand\\familydefault{\\sfdefault}"


@dataclass(frozen=True)
class ResumeTemplate:
    """One entry in the gallery.

    ``id``          — stable key stored in ``profile.yml::resume_template``.
    ``label``       — short human name for onboarding menus.
    ``summary``     — one-line description (onboarding pick / README).
    ``look``        — longer "what it looks like" blurb for the README.
    ``latex_source``— the BASE_TEMPLATE with typography tokens filled, still
                      holding the <<...>> body placeholders the tailor fills.
    """

    id: str
    label: str
    summary: str
    look: str
    latex_source: str


# ── The gallery ─────────────────────────────────────────────────────────────
# 5 distinct looks, every one the same ATS-safe single-column body.

TEMPLATES: dict[str, ResumeTemplate] = {
    "classic": ResumeTemplate(
        id="classic",
        label="Classic",
        summary="Serif, hairline-ruled link-blue headings. The safe default.",
        look=(
            "Computer Modern serif. Centered name in \\LARGE. Section titles "
            "are bold link-blue with a hairline rule beneath. Balanced spacing. "
            "The conservative, universally-readable choice; the default."
        ),
        latex_source=_apply_style(
            ptsize="11pt", margin="0.5in", font="", namesize=r"\LARGE",
            section=_SECTION_RULE,
            titlespace=r"\titlespacing*{\section}{0pt}{12pt}{6pt}",
            listspace=r"\setlist[itemize]{leftmargin=1.2em, itemsep=2pt, parsep=0pt, topsep=2pt}",
        ),
    ),
    "modern": ResumeTemplate(
        id="modern",
        label="Modern",
        summary="Clean sans-serif, ruled headings, a touch more whitespace.",
        look=(
            "Latin Modern Sans throughout. Centered name in \\LARGE. Bold "
            "link-blue ruled section titles like Classic, but the sans face and "
            "airier list/title spacing read as contemporary. Good for "
            "software / AI / product-adjacent roles."
        ),
        latex_source=_apply_style(
            ptsize="11pt", margin="0.5in", font=_SANS_FONT, namesize=r"\LARGE",
            section=_SECTION_RULE,
            titlespace=r"\titlespacing*{\section}{0pt}{14pt}{8pt}",
            listspace=r"\setlist[itemize]{leftmargin=1.2em, itemsep=3pt, parsep=0pt, topsep=3pt}",
        ),
    ),
    "compact": ResumeTemplate(
        id="compact",
        label="Compact",
        summary="Serif, tight spacing and narrow margins for dense resumes.",
        look=(
            "Computer Modern serif with a slightly smaller \\large name, "
            "0.45in margins and tight list/section spacing. Same ruled "
            "link-blue headings as Classic, but fits noticeably more content "
            "before the one-page trim loop has to cut. Good for senior / "
            "many-project histories."
        ),
        latex_source=_apply_style(
            ptsize="11pt", margin="0.45in", font="", namesize=r"\large",
            section=_SECTION_RULE,
            titlespace=r"\titlespacing*{\section}{0pt}{8pt}{3pt}",
            listspace=r"\setlist[itemize]{leftmargin=1.1em, itemsep=1pt, parsep=0pt, topsep=1pt}",
        ),
    ),
    "accent": ResumeTemplate(
        id="accent",
        label="Accent",
        summary="Minimalist sans, large name, uppercase accent headings, no rule.",
        look=(
            "Latin Modern Sans with a bold \\huge name and generous 0.6in "
            "margins. Section titles are UPPERCASE link-blue with no rule, "
            "leaning on whitespace and the accent color instead of lines for "
            "structure. The most visually distinctive, minimalist option."
        ),
        latex_source=_apply_style(
            ptsize="11pt", margin="0.6in", font=_SANS_FONT, namesize=r"\huge",
            section=_SECTION_NORULE_UPPER,
            titlespace=r"\titlespacing*{\section}{0pt}{16pt}{8pt}",
            listspace=r"\setlist[itemize]{leftmargin=1.2em, itemsep=3pt, parsep=0pt, topsep=3pt}",
        ),
    ),
    "executive": ResumeTemplate(
        id="executive",
        label="Executive",
        summary="Traditional serif, large name, uppercase black ruled headings.",
        look=(
            "Computer Modern serif at 10.5pt with a \\huge name and 0.55in "
            "margins. Section titles are UPPERCASE black (not colored) over a "
            "full-width rule — a formal, traditional look that suits "
            "research / academic-adjacent and senior individual-contributor "
            "applications."
        ),
        latex_source=_apply_style(
            ptsize="10.5pt", margin="0.55in", font="", namesize=r"\huge",
            section=_SECTION_RULE_UPPER_BLACK,
            titlespace=r"\titlespacing*{\section}{0pt}{12pt}{6pt}",
            listspace=r"\setlist[itemize]{leftmargin=1.2em, itemsep=2pt, parsep=0pt, topsep=2pt}",
        ),
    ),
}

# The fallback template id when the profile leaves ``resume_template`` unset or
# names one not in the gallery. Conservative + universally ATS-readable.
DEFAULT_TEMPLATE_ID = "classic"


def template_ids() -> list[str]:
    """Stable-ordered list of gallery template ids."""
    return list(TEMPLATES.keys())


def get_template(template_id: str | None) -> ResumeTemplate:
    """Return the gallery entry for ``template_id``, falling back to the
    default when it's unset / unknown. Never raises — a bad profile value
    must degrade to the safe default, not crash a tailor run."""
    if template_id:
        hit = TEMPLATES.get(template_id.strip())
        if hit is not None:
            return hit
    return TEMPLATES[DEFAULT_TEMPLATE_ID]


def is_valid_template_id(template_id: str | None) -> bool:
    """True iff ``template_id`` names a template in the gallery."""
    return bool(template_id) and template_id.strip() in TEMPLATES


def gallery() -> list[ResumeTemplate]:
    """All templates in stable order (for onboarding menus / docs)."""
    return list(TEMPLATES.values())
