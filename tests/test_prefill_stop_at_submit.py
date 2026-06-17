"""Stop-at-submit invariant (WS-D).

The live visible-browser pre-fill must fill every field it can and then PARK
the browser before the ATS's final Submit button — the human always clicks
Submit themselves. This is the one feature that must be preserved exactly.

Two live pre-fill paths exist; this module pins the invariant on both so a
future refactor that wires up an auto-submit tool/override fails loudly:

  1. Agent path (``prepare_loop`` + ``UniversalApplicant``): a Claude tool-use
     loop. The invariant is that the tool-set exposes NO way to submit — the
     only terminal tools are ``finish_preparation`` and ``queue_for_review``.
  2. Deterministic path (``prepare_dom`` field-map fillers): the per-ATS
     fillers only ever fill/upload/paste mapped fields; the declarative field
     maps contain no submit control, and the applicants never override
     ``BaseApplicant.submit`` (which raises rather than clicking).

The legacy Browserbase/Stagehand ``confirm.py`` DOES click submit, but it is
dead code (no console-script binding, no live caller) and is excluded here on
purpose — the invariant is about the path the cockpit actually drives.
"""

from __future__ import annotations

import os

# ``jobify.submit.config`` fails loud on missing secrets at import time, and the
# ``universal``/``prepare_loop`` imports below pull it in. Seed throwaway values
# before importing so collection doesn't require a real .env (matches the
# env-before-import convention used elsewhere in the submit test suite).
for _k, _v in {
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_KEY": "anon-test",
    "SUPABASE_SERVICE_ROLE_KEY": "service-test",
    "BROWSERBASE_API_KEY": "bb-test",
    "BROWSERBASE_PROJECT_ID": "bb-proj-test",
    "ANTHROPIC_API_KEY": "sk-test",
}.items():
    os.environ.setdefault(_k, _v)

import pytest

from jobify.submit.adapters.applicant_base import BaseApplicant
from jobify.submit.adapters.prepare_dom.ashby import AshbyApplicant
from jobify.submit.adapters.prepare_dom.field_maps import (
    apply_field_map,
    load_field_map,
)
from jobify.submit.adapters.prepare_dom.greenhouse import GreenhouseApplicant
from jobify.submit.adapters.prepare_dom.lever import LeverApplicant
from jobify.submit.adapters.prepare_dom.universal import UniversalApplicant
from jobify.submit.adapters.prepare_loop import TOOL_SCHEMAS


# ── Agent path: the tool-set cannot submit ──────────────────────────────────

_TERMINAL_TOOLS = {"finish_preparation", "queue_for_review"}


def test_prepare_loop_exposes_no_submit_tool():
    """No tool in the agent's tool-set can submit the form.

    A ``click_submit`` (or any submit-capable) tool would let the agent press
    the final button — exactly what M-4 forbids. Guard the tool *names*."""
    names = {t["name"] for t in TOOL_SCHEMAS}
    assert not any("submit" in n.lower() for n in names), (
        f"prepare_loop exposes a submit-capable tool: {sorted(names)}"
    )
    # The two terminal tools are present and are the only way the loop ends.
    assert _TERMINAL_TOOLS <= names


def test_no_tool_description_offers_to_click_submit():
    """Defense-in-depth: no tool's prose invites the agent to click Submit.

    The ``click`` tool exists for dropdowns / multi-step navigation; its
    description explicitly reserves Submit for the human."""
    for tool in TOOL_SCHEMAS:
        desc = tool.get("description", "").lower()
        if "submit" in desc:
            # The only legitimate mention is the explicit human-gate carve-out.
            assert "human" in desc, (
                f"tool {tool['name']!r} mentions submit without the human gate"
            )


def test_click_tool_reserves_submit_for_the_human():
    click = next(t for t in TOOL_SCHEMAS if t["name"] == "click")
    desc = click["description"].lower()
    assert "no click_submit" in desc or "human clicks submit" in desc


# ── Deterministic path: applicants never auto-submit ────────────────────────

@pytest.mark.parametrize(
    "applicant_cls",
    [GreenhouseApplicant, LeverApplicant, AshbyApplicant, UniversalApplicant],
)
def test_applicants_do_not_override_submit(applicant_cls):
    """None of the live applicants override ``BaseApplicant.submit``.

    Inheriting the base means a stray ``applicant.submit(...)`` raises
    NotImplementedError instead of silently clicking the ATS button."""
    assert applicant_cls.submit is BaseApplicant.submit


@pytest.mark.parametrize(
    "applicant_cls",
    [GreenhouseApplicant, LeverApplicant, AshbyApplicant, UniversalApplicant],
)
def test_base_submit_raises_rather_than_clicking(applicant_cls):
    app = applicant_cls()
    with pytest.raises(NotImplementedError):
        app.submit({"id": "x"})


# ── Deterministic path: the field maps contain no submit control ────────────

class _StubLocator:
    def __init__(self, selector: str, page: "_StubPage"):
        self.selector = selector
        self.page = page

    @property
    def first(self):
        return self

    def is_visible(self, timeout: int = 1000) -> bool:
        # Report everything visible so apply_field_map actually walks the
        # whole selector chain for every spec (maximizes selectors queried).
        return True

    def count(self) -> int:
        return 1

    def click(self) -> None:
        self.page.clicks.append(self.selector)

    def fill(self, value: str) -> None:
        pass

    def set_input_files(self, file_path: str) -> None:
        pass

    def select_option(self, value: str) -> None:
        pass


class _StubPage:
    def __init__(self) -> None:
        self.locator_calls: list[str] = []
        self.clicks: list[str] = []

    def locator(self, selector: str) -> _StubLocator:
        self.locator_calls.append(selector)
        return _StubLocator(selector, self)


@pytest.mark.parametrize("ats", ["greenhouse", "lever", "ashby"])
def test_field_maps_query_and_click_no_submit_control(ats):
    """Running the real per-ATS field map fills only mapped fields — it never
    queries or clicks a submit/apply button.

    apply_field_map dispatches each declarative spec to a fill/upload/paste/
    select primitive; the only ``click()`` it issues is focusing a text input
    before typing. So neither the *queried* selectors nor the *clicked*
    elements may target a Submit control."""
    specs = load_field_map(ats)
    assert specs, f"no field map for {ats}"

    # Give every spec key a value so each one is actually attempted.
    values = {s.get("key"): "x" for s in specs}
    page = _StubPage()
    apply_field_map(page, specs, values)

    assert page.locator_calls, "field map attempted nothing"
    for selector in page.locator_calls + page.clicks:
        assert "submit" not in selector.lower(), (
            f"{ats} field map touched a submit control: {selector!r}"
        )
