# Resume template gallery (WS-F)

A small gallery of **ATS-safe, one-page LaTeX resume templates**. The user
picks one during onboarding (WS-E); the tailor renders the chosen one for
every job. The pick is stored as `resume_template` in `profile.yml` and read by
`jobify.tailor.tailor.latex_resume._select_template`.

Every template renders the **same structured content** (contact header →
Education & Technical Skills → Experience), so they're fully interchangeable —
they differ only in *typography*, never in layout. That's deliberate: it's what
lets us guarantee ATS-safety **by construction** (see [Why they're all
safe](#why-every-template-is-ats-safe)).

---

## The templates

All previews below are schematic — `==` is a ruled section heading, `--` an
unruled one, `•` a bullet. Contact line is always one centered plain-text row.

### `classic` — the safe default
Computer Modern **serif**. Centered name (LARGE). Bold **link-blue** section
titles with a **hairline rule**. Balanced spacing. The conservative,
universally-readable choice. Default when `resume_template` is unset and the
role archetype has no override.

```
                 Jordan Rivera
        jordan@example.com · Denver, CO · linkedin · site
  Education & Technical Skills ===============================
    Education      B.S. ... (2014–2018)
    Languages      Python, Go, ...
  Experience ===================================================
    Northwind Systems                                   Remote
    • Led migration of a monolith to seven services ...
```

### `modern` — clean & contemporary
Latin Modern **Sans** throughout. Same ruled link-blue headings as Classic, but
the sans face plus airier list/title spacing read as contemporary. Good for
software / AI / product-adjacent roles.

### `compact` — fits more
Serif with a slightly smaller name, **0.45in margins** and tight spacing. Same
ruled headings; packs noticeably more content before the one-page trim loop has
to cut. Good for senior / many-project histories.

### `accent` — minimalist
Latin Modern Sans, **huge** name, generous **0.6in** margins. Section titles are
**UPPERCASE link-blue with no rule** — structure comes from whitespace and the
accent color, not lines. The most visually distinctive option.

```
              JORDAN RIVERA
       jordan@example.com · Denver, CO · ...
  EDUCATION & TECHNICAL SKILLS
    Languages      Python, Go, ...
  EXPERIENCE
    Northwind Systems                                   Remote
    • Led migration ...
```

### `executive` — traditional
Serif at **10.5pt**, huge name, **0.55in** margins. Section titles are
**UPPERCASE black** (not colored) over a **full-width rule** — a formal,
traditional look that suits research / academic-adjacent and senior IC roles.

---

## Why every template is ATS-safe

Applicant tracking systems parse the PDF's text layer. A pretty resume that
extracts as scrambled or empty text is worse than a plain one. Every template
here obeys these rules — and an automated gate proves it:

| Rule | How it's guaranteed |
|---|---|
| **Single-column body** — no multi-column flow that interleaves on extraction | All templates share one single-column skeleton; no `multicol` / `\columnbreak`. |
| **No text baked into images/graphics** | No `graphicx` / `\includegraphics`; contact info is real text. |
| **Standard, embeddable fonts** | Computer Modern (serif) and Latin Modern Sans only — both ship with every TeX install; no `fontspec`/exotic fonts. |
| **Nothing critical in headers/footers** | `\pagestyle{empty}`; the contact line is in the body. |
| **No color blocks behind text** | Only colored *heading text* (still selectable); no highlight boxes. |
| **Selectable text in reading order** | Verified by extraction (below). |

The skills block uses a simple two-column **label → value** table for
alignment. That is *not* a multi-column layout — each row is one logical line
(`Languages   Python, Go, …`) and round-trips in reading order. The parse gate
verifies this directly rather than trusting it.

## The parse gate

`tests/test_resume_templates.py` runs in CI for **every** template:

1. **Static checks** (no TeX needed): asserts the rules in the table above by
   inspecting the template source.
2. **Render → extract → assert**: compiles the template to a real PDF with
   `pdflatex`, then extracts the text with up to **two independent parsers** —
   [`pdftotext`](https://poppler.freedesktop.org/) (poppler) and
   [`pdfminer.six`](https://pdfminersix.readthedocs.io/) — and asserts that
   every section heading, contact field, skill, and bullet comes back as clean
   selectable text **in the correct reading order**, with nothing lost or
   scrambled, and that the result is exactly **one page**.

The render step skips gracefully when `pdflatex` / a text extractor isn't
installed, so the suite still collects on a bare checkout. To run the full gate
locally, install a TeX distribution and poppler (`pdftotext`) — see
`docs/SETUP.md`.

```bash
pytest -k resume_templates
```

## Adding a template

1. Add a `ResumeTemplate` entry to `TEMPLATES` in `__init__.py`. Build its
   `latex_source` via `_apply_style(...)` — vary **only** the typography tokens
   (font, name size, point size, margins, section-heading format, spacing).
   Don't touch the shared body / header; that's what keeps it ATS-safe.
2. Add the id to the `resume_template` enum in
   `onboarding/schema/profile.schema.json` and to the options comment in
   `profile.example/profile.yml`.
3. Run `pytest -k resume_templates`. The gate renders and parse-checks your new
   template automatically — if it passes, it's safe to ship.
