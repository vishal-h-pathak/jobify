# Session 07 — WS-F: ATS-safe resume template gallery  (Wave 2)

**Run from:** `jobify/`.
**Depends on:** WS-A1 (01) profile contract (for how the tailor selects a
template). Pairs with WS-E (06), which offers the pick during onboarding.
**Parallel-safe with:** WS-A2 (04), WS-D (05), WS-E (06) — writes under
`resume_templates/` + the tailor's template-selection hook.

---

## Context

Output is a one-page LaTeX resume rendered to PDF. We want a small gallery of
visually distinct templates the user picks from during onboarding — but EVERY
template must survive ATS text extraction, or it defeats the purpose. Read
`jobify/planning/PROJECT_PLAN.md` §5 (WS-F) + R1.

## Goal

3–5 distinct one-page LaTeX templates, each proven ATS-parsable by an automated
test, wired so the tailor renders whichever the user selected.

## Tasks

1. **Build the gallery** under `resume_templates/` — ≈3–5 templates with
   genuinely different looks (e.g. classic single-column, modern single-column
   with a subtle accent, compact two-section). Each takes the same structured
   content (from `profile/cv.md` + the tailor's selection/reordering) so they're
   interchangeable.
2. **ATS-parsability gate (the important part).** For each template: render to
   PDF, extract text with `pdftotext` (and ideally a second parser), and assert:
   - all section headings and bullet content come back as selectable text,
   - in the correct reading order,
   - contact info is real text (not an image),
   - no content is lost or scrambled.
   Forbid the things that break ATS parsers: multi-column layouts that interleave
   on extraction, text baked into images/graphics, exotic fonts, critical info in
   headers/footers, tables for layout. Write this as an automated `pytest` that
   runs for every template in the gallery.
3. **Wire template selection** into the tailor: it reads the user's chosen
   template id from the profile and renders with it. Default to one template if
   unset. Update `tailor/latex_resume.py` accordingly (coordinate with WS-A2,
   which sources resume *content* from `cv.md`; WS-F owns *layout*).
4. **Document** the gallery (a `resume_templates/README.md` with a thumbnail/
   description per template and the parsability rules) so onboarding can present
   choices.

## Exit criteria

- `pytest -k resume_templates` (or similar) renders every template and passes the
  extraction assertions for all of them.
- The tailor renders a chosen template end-to-end for the example persona.
- Commit: `WS-F: ATS-safe one-page resume gallery + parse gate`.

## Note
Keep LaTeX dependencies minimal and documented in SETUP.md (e.g. a TeX
distribution + `pdftotext` from poppler). If full LaTeX is too heavy a dep,
note the alternative the repo already uses for PDF rendering and stay consistent
with it.
