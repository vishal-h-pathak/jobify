"""tests/test_v3b_prompts.py — V3B S1 Task 3 prompt-template smoke test.

`jobify/tailor/prompts/attribute_claims.md` (new) and
`jobify/tailor/prompts/tailor_latex_resume.md` (additive `sources` edit)
are markdown prompt templates, not executable code — the meaningful
"test" for a template file is that it renders without a `.format()`
KeyError/ValueError and that every named placeholder actually got
substituted (no `{placeholder}` artifact left in the output).

`load_task_prompt` (`jobify/tailor/prompts/__init__.py`) is a pure
template-format function: it reads `prompts/{name}.md`, calls
`.format(**vars)`, and returns the joined string. It never touches
`jobify.profile_loader`'s file-reading functions (unlike `load_prompt`/
`cached_system_blocks`, which splice in the merged candidate profile) —
so this test needs no `JOBIFY_PROFILE_DIR` / `tmp_profile` fixture.
"""

from __future__ import annotations

import re

from jobify.tailor.prompts import load_task_prompt

# Alex Quinn is the shipped neutral example persona
# (`profile.example/`) — scrub-gate convention: no operator PII in
# fixtures/prompts/tests.
_STUB_CV_MARKDOWN = """# CV

## Skills

- Python, Kubernetes, Terraform, AWS Lambda

## Experience

### Northwind Robotics — Senior Platform Engineer
Atlanta, GA | 2021—Present

- Rewrote the detector inference runtime in Rust, cutting p95 latency
  from 2.1s to 380ms on Jetson Orin.
"""

_STUB_COVER_LETTER_TEXT = (
    "I've spent the last few years building inference systems that have "
    "to work under real latency pressure. Northwind Robotics is doing "
    "exactly that kind of work, which is why this role caught my eye."
)


def _assert_rendered_cleanly(rendered: str, placeholder_names: list[str]) -> None:
    """Non-empty output; none of the named placeholders survived unresolved."""
    assert isinstance(rendered, str)
    assert rendered.strip()
    for name in placeholder_names:
        assert "{" + name + "}" not in rendered, (
            f"placeholder {{{name}}} was not substituted"
        )
    # Belt-and-suspenders: no bare `{identifier}` pattern (the shape of an
    # unresolved str.format placeholder) survives anywhere in the output.
    # Doubled JSON braces (`{{ }}`) collapse to literal single `{`/`}` by
    # this point, so any single-brace `{word}` left over would mean a
    # placeholder was missed, not literal JSON.
    leftover = re.findall(r"(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*\}(?!\})", rendered)
    assert not leftover, f"unresolved template artifact(s): {leftover}"


def test_attribute_claims_renders_cleanly():
    rendered = load_task_prompt(
        "attribute_claims",
        cover_letter_text=_STUB_COVER_LETTER_TEXT,
        cv_markdown=_STUB_CV_MARKDOWN,
    )
    _assert_rendered_cleanly(rendered, ["cover_letter_text", "cv_markdown"])
    # The response-shape contract Task 5 depends on must be spelled out.
    assert '"units"' in rendered
    assert "cl.s0" in rendered
    assert "cl_sentence" in rendered
    assert '"voice"' in rendered


def test_tailor_latex_resume_renders_cleanly():
    rendered = load_task_prompt(
        "tailor_latex_resume",
        cv_markdown=_STUB_CV_MARKDOWN,
        tailoring_json="{}",
        job_title="Platform Engineer",
        company="Beacon Robotics",
        job_desc="Build and operate inference infrastructure.",
        match_chat_block="",
        archetype_block="",
    )
    _assert_rendered_cleanly(
        rendered,
        [
            "cv_markdown",
            "tailoring_json",
            "job_title",
            "company",
            "job_desc",
            "match_chat_block",
            "archetype_block",
        ],
    )
    # The additive sources contract must be present and must not have
    # replaced the pre-existing "skills"/"bullets"/"summary_line" shape.
    assert '"skills_sources"' in rendered
    assert '"bullet_sources"' in rendered
    assert '"summary_sources"' in rendered
    assert '"skills"' in rendered
    assert '"bullets"' in rendered
    assert '"summary_line"' in rendered
