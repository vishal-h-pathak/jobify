"""
tailor/cover_letter_pdf.py — Render cover letter text to PDF bytes.

Uses reportlab to produce a clean letter-format PDF: a letterhead with name
+ contact row, date, then body paragraphs. The candidate's identity comes
from ``jobify.profile_loader`` (profile.yml::identity) — never hard-coded.
No fabricated content — it just wraps plain text in letter formatting.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime
from typing import Optional

from jobify import profile_loader
from tailor.normalize import normalize_for_ats

logger = logging.getLogger("tailor.cover_letter_pdf")


# ── Letterhead fields (sourced from profile.yml::identity via the loader) ──

def _letterhead() -> dict[str, str]:
    """Return the candidate's letterhead identity from the loaded profile.

    Reads ``profile.yml::identity`` (the same single source the LaTeX resume
    header and form-answers identity block use). Missing fields degrade to
    empty strings so the contact row simply omits them.
    """
    identity = profile_loader.load_profile().get("identity") or {}
    loc_comp = profile_loader.load_profile().get("location_and_compensation") or {}
    return {
        "name": identity.get("name") or "",
        "email": identity.get("email") or "",
        "location": identity.get("location_base") or loc_comp.get("base") or "",
        "linkedin": identity.get("linkedin") or "",
        "website": identity.get("website") or "",
    }


def _styles():
    """Build a paragraph stylesheet tuned for a cover letter."""
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet

    base = getSampleStyleSheet()
    return {
        "header_name": ParagraphStyle(
            "header_name",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            alignment=1,  # centered
            spaceAfter=4,
        ),
        "header_contact": ParagraphStyle(
            "header_contact",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=12,
            alignment=1,
            textColor="#444444",
            spaceAfter=16,
        ),
        "date": ParagraphStyle(
            "date",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            spaceAfter=14,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            spaceAfter=10,
            alignment=0,  # left
        ),
        "sign_off": ParagraphStyle(
            "sign_off",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=14,
            spaceBefore=14,
        ),
    }


def _split_paragraphs(text: str) -> list[str]:
    """Break the letter body into paragraphs on blank lines."""
    paragraphs: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.strip():
            current.append(line.strip())
        else:
            if current:
                paragraphs.append(" ".join(current))
                current = []
    if current:
        paragraphs.append(" ".join(current))
    return paragraphs


def _escape_html(text: str) -> str:
    """reportlab's Paragraph parses HTML-ish markup; escape & < >."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def render_cover_letter_pdf(
    cover_letter_text: str,
    company: Optional[str] = None,
    role: Optional[str] = None,
    today: Optional[str] = None,
) -> bytes:
    """
    Render cover letter plain text to PDF bytes.

    Args:
        cover_letter_text: The letter body (paragraphs separated by blank lines).
        company: Optional recipient company name — prepended as "Dear {company} team,"
                 only if the text doesn't already start with a salutation.
        role: Optional role title — shown in the date line for context.
        today: Optional ISO date string; defaults to today.

    Returns:
        Raw PDF bytes.
    """
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate

    text = normalize_for_ats((cover_letter_text or "").strip())
    if not text:
        raise ValueError("Empty cover letter text — nothing to render.")

    head = _letterhead()
    name = head["name"]
    styles = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=0.9 * inch,
        rightMargin=0.9 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        title=f"Cover Letter — {name}",
        author=name,
    )

    story = []

    # ── Header: name + contact row ──────────────────────────────────────
    if name:
        story.append(Paragraph(name, styles["header_name"]))
    contact_bits = [b for b in (head["email"], head["location"], head["linkedin"], head["website"]) if b]
    story.append(
        Paragraph(
            " &middot; ".join(_escape_html(b) for b in contact_bits),
            styles["header_contact"],
        )
    )

    # ── Date line ───────────────────────────────────────────────────────
    date_str = today or datetime.now().strftime("%B %d, %Y")
    date_line = date_str
    if company and role:
        date_line = f"{date_str} &nbsp;&middot;&nbsp; Re: {_escape_html(role)} at {_escape_html(company)}"
    story.append(Paragraph(date_line, styles["date"]))

    # ── Body ────────────────────────────────────────────────────────────
    paragraphs = _split_paragraphs(text)

    # If body doesn't open with "Hi", "Hello", "Dear", etc., prepend a
    # salutation so the letter reads cleanly when printed.
    first_para = paragraphs[0] if paragraphs else ""
    opens_with_salutation = bool(
        first_para
        and any(
            first_para.lower().startswith(prefix)
            for prefix in ("dear ", "hi ", "hello ", "hey ", "to whom", "greetings")
        )
    )
    if not opens_with_salutation:
        salutation = "Hi"
        if company:
            salutation = f"Hi {company} team,"
        else:
            salutation = "Hello,"
        story.append(Paragraph(_escape_html(salutation), styles["body"]))

    for para in paragraphs:
        story.append(Paragraph(_escape_html(para), styles["body"]))

    # ── Sign-off ────────────────────────────────────────────────────────
    # Detect an existing sign-off in the body (e.g. "— <First>" already there)
    # so we don't double up. Build the name markers from the candidate's own
    # name rather than a hard-coded identity.
    body_lower = text.lower()
    first_name = (name.split()[0] if name else "").lower()
    name_markers = []
    if first_name:
        name_markers = [f"— {first_name}", f"-- {first_name}"]
    has_sign_off = any(
        marker in body_lower
        for marker in (*name_markers, "best,", "thanks,", "cheers,")
    )
    if not has_sign_off:
        story.append(Paragraph("Best,", styles["sign_off"]))
        if name:
            story.append(Paragraph(name, styles["body"]))

    doc.build(story)
    return buf.getvalue()
