"""tests/test_prompt_caching.py — Session I: prompt caching across tailor calls.

Every tailor LLM call must send the identical static prefix
(_shared.md rules + thesis-first candidate profile + voice profile) as
``system`` content blocks with ``cache_control`` on the final block,
and keep only per-job content in the (uncached) user turn. Identical
prefixes are what make the cache hit across the six call sites.
"""

from __future__ import annotations

import pytest

from jobify.tailor import pipeline  # noqa: F401 — sys.path bootstrap
from jobify.shared import llm

import prompts as tailor_prompts
from tailor import archetype as archetype_mod
from tailor import cover_letter as cl_mod
from tailor import form_answers as fa_mod
from tailor import resume as resume_mod

_ARCHETYPE_STUB = {"archetype": "tier_1a_compneuro", "confidence": 0.9, "reasoning": "s"}


@pytest.fixture(autouse=True)
def _api_path_active(monkeypatch):
    """PR-15: the tailor call sites now route through jobify.shared.llm,
    which prefers the Messages API only when ANTHROPIC_API_KEY is set and
    not benched. Give every test a usable, un-benched key so the API path
    (the one these tests patch) is taken."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(llm, "_api_key_cool_off_until", 0.0)


def _patch_api_client(monkeypatch, fake):
    """Route llm.complete()'s API path at the shared client seam."""
    monkeypatch.setattr(llm, "_anthropic_client", lambda *a, **k: fake)


def _job() -> dict:
    return {
        "id": "cache-test",
        "title": "Research Engineer",
        "company": "TestCo",
        "description": "Build things.",
        "tier": 1,
        "_archetype": dict(_ARCHETYPE_STUB),
    }


class _FakeBlock:
    def __init__(self, text: str):
        self.text = text


class _FakeClient:
    def __init__(self, response_text: str):
        self.sent: list[dict] = []
        outer = self

        class _Messages:
            def create(self, **kwargs):
                outer.sent.append(kwargs)

                class _Resp:
                    content = [_FakeBlock(response_text)]

                return _Resp()

        self.messages = _Messages()


# ── `*_with_usage` siblings (V3B Task 5a — H4 ledger) ────────────────────────
#
# `tailor_resume`, `generate_tailored_latex`, `generate_cover_letter`, and
# `classify_archetype` each gained a `*_with_usage` sibling that shares the
# exact same prompt-build + parse helper and only forks the return type to
# also surface `CompletionUsage` (for `jobify.db.insert_budget_ledger_row`,
# Task 5b). These pin: same result shape as the plain function, and a
# non-fake usage matching what the fake client's `.usage` carried.


class _FakeUsage:
    def __init__(self, input_tokens: int, output_tokens: int):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class _FakeClientWithUsage:
    """Like `_FakeClient`, but the canned response also carries `.usage`."""

    def __init__(self, response_text: str, input_tokens: int, output_tokens: int):
        self.sent: list[dict] = []
        outer = self

        class _Messages:
            def create(self, **kwargs):
                outer.sent.append(kwargs)

                class _Resp:
                    content = [_FakeBlock(response_text)]
                    usage = _FakeUsage(input_tokens, output_tokens)

                return _Resp()

        self.messages = _Messages()


def test_cached_system_blocks_shape():
    blocks = tailor_prompts.cached_system_blocks()
    assert len(blocks) == 1
    block = blocks[0]
    assert block["type"] == "text"
    assert block["cache_control"] == {"type": "ephemeral"}
    text = block["text"]
    # Global rules + thesis-first profile + voice profile, in that order.
    assert "Global Rules" in text
    assert "========== thesis.md (CANONICAL" in text
    assert "CANDIDATE PROFILE" in text
    assert "VOICE PROFILE" in text
    assert text.index("Global Rules") < text.index("thesis.md (CANONICAL")


def test_cached_system_blocks_is_stable():
    """Same object every call — the byte-identical prefix the cache needs."""
    assert tailor_prompts.cached_system_blocks() is tailor_prompts.cached_system_blocks()


def _assert_cached_call(kwargs: dict):
    assert kwargs["system"] is tailor_prompts.cached_system_blocks()
    user_text = kwargs["messages"][0]["content"]
    # Per-job turn must not duplicate the cached prefix content.
    assert "Global Rules" not in user_text
    assert "========== profile.yml" not in user_text
    assert "{profile}" not in user_text and "{voice_profile}" not in user_text


def test_tailor_resume_uses_cached_prefix(monkeypatch):
    fake = _FakeClient('{"tailored_summary": "x", "emphasis_areas": []}')
    _patch_api_client(monkeypatch, fake)
    resume_mod.tailor_resume(_job())
    _assert_cached_call(fake.sent[0])


def test_cover_letter_uses_cached_prefix(monkeypatch):
    fake = _FakeClient("body")
    _patch_api_client(monkeypatch, fake)
    cl_mod.generate_cover_letter(_job())
    _assert_cached_call(fake.sent[0])


def test_latex_resume_uses_cached_prefix(monkeypatch):
    from tailor import latex_resume as latex_mod  # noqa: F401 — kept for parity

    fake = _FakeClient('{"skills": {}, "experience": []}')
    _patch_api_client(monkeypatch, fake)
    result = latex_mod.generate_tailored_latex(_job(), {"_archetype": dict(_ARCHETYPE_STUB)})
    assert "latex_source" in result
    _assert_cached_call(fake.sent[0])


def test_form_answers_uses_cached_prefix(monkeypatch):
    fake = _FakeClient(
        '{"why_this_role": "x", "why_this_company": "y", '
        '"additional_info": null, "additional_questions": []}'
    )
    _patch_api_client(monkeypatch, fake)
    fa_mod.generate_form_answers(_job(), {}, archetype_meta=dict(_ARCHETYPE_STUB))
    _assert_cached_call(fake.sent[0])


def test_classifier_uses_cached_prefix(monkeypatch):
    fake = _FakeClient(
        '{"archetype": "tier_1a_compneuro", "confidence": 0.8, "reasoning": "x"}'
    )
    _patch_api_client(monkeypatch, fake)
    job = _job()
    job.pop("_archetype")
    archetype_mod.classify_archetype(job)
    _assert_cached_call(fake.sent[0])


def test_prefix_is_big_enough_to_cache():
    """Anthropic only caches prefixes >= 1024 tokens (Sonnet-class).

    Chars/4 is a conservative token estimate; the real prefix is far
    above the floor, so this guards against an accidental gutting of
    the system block (e.g. profile load silently returning empty).
    """
    text = tailor_prompts.cached_system_blocks()[0]["text"]
    assert len(text) / 4 > 1024


def test_tailor_resume_with_usage_matches_plain_and_returns_real_usage(monkeypatch):
    fake = _FakeClientWithUsage(
        '{"tailored_summary": "x", "emphasis_areas": []}',
        input_tokens=111, output_tokens=22,
    )
    _patch_api_client(monkeypatch, fake)
    result, usage = resume_mod.tailor_resume_with_usage(_job())

    assert usage == llm.CompletionUsage(input_tokens=111, output_tokens=22)
    # Same result shape as the plain function.
    fake_plain = _FakeClientWithUsage(
        '{"tailored_summary": "x", "emphasis_areas": []}',
        input_tokens=111, output_tokens=22,
    )
    _patch_api_client(monkeypatch, fake_plain)
    plain_result = resume_mod.tailor_resume(_job())
    assert result["tailored_summary"] == plain_result["tailored_summary"]
    assert result["_archetype"] == plain_result["_archetype"]


def test_cover_letter_with_usage_matches_plain_and_returns_real_usage(monkeypatch):
    fake = _FakeClientWithUsage(
        "A cover letter body.", input_tokens=200, output_tokens=80,
    )
    _patch_api_client(monkeypatch, fake)
    result, usage = cl_mod.generate_cover_letter_with_usage(_job())

    assert result == {"cover_letter": "A cover letter body."}
    assert usage == llm.CompletionUsage(input_tokens=200, output_tokens=80)
    # Same result shape as the plain function.
    fake_plain = _FakeClientWithUsage(
        "A cover letter body.", input_tokens=200, output_tokens=80,
    )
    _patch_api_client(monkeypatch, fake_plain)
    assert cl_mod.generate_cover_letter(_job()) == result


def test_latex_resume_with_usage_matches_plain_and_returns_real_usage(monkeypatch):
    from tailor import latex_resume as latex_mod

    fake = _FakeClientWithUsage(
        '{"skills": {}, "experience": []}', input_tokens=321, output_tokens=64,
    )
    _patch_api_client(monkeypatch, fake)
    result, usage = latex_mod.generate_tailored_latex_with_usage(
        _job(), {"_archetype": dict(_ARCHETYPE_STUB)}
    )

    assert "latex_source" in result
    assert usage == llm.CompletionUsage(input_tokens=321, output_tokens=64)
    # Same result shape as the plain function.
    fake_plain = _FakeClientWithUsage(
        '{"skills": {}, "experience": []}', input_tokens=321, output_tokens=64,
    )
    _patch_api_client(monkeypatch, fake_plain)
    plain_result = latex_mod.generate_tailored_latex(
        _job(), {"_archetype": dict(_ARCHETYPE_STUB)}
    )
    assert set(result.keys()) == set(plain_result.keys())


def test_classifier_with_usage_matches_plain_and_returns_real_usage(monkeypatch):
    # "developer_facing" is a real archetype key in the shipped example
    # profile (unlike test_tailor_thesis.py's `tier_1a_compneuro` stub,
    # which is only ever pre-stashed and never round-tripped through the
    # classifier's own archetype-key validation).
    fake = _FakeClientWithUsage(
        '{"archetype": "developer_facing", "confidence": 0.8, "reasoning": "x"}',
        input_tokens=50, output_tokens=10,
    )
    _patch_api_client(monkeypatch, fake)
    job = _job()
    job.pop("_archetype")
    result, usage = archetype_mod.classify_archetype_with_usage(job)

    assert result["archetype"] == "developer_facing"
    assert usage == llm.CompletionUsage(input_tokens=50, output_tokens=10)
    # Same result shape as the plain function.
    fake_plain = _FakeClientWithUsage(
        '{"archetype": "developer_facing", "confidence": 0.8, "reasoning": "x"}',
        input_tokens=50, output_tokens=10,
    )
    _patch_api_client(monkeypatch, fake_plain)
    job2 = _job()
    job2.pop("_archetype")
    plain_result = archetype_mod.classify_archetype(job2)
    assert result["archetype"] == plain_result["archetype"]


def test_classifier_with_usage_is_zero_when_no_archetypes_configured(monkeypatch):
    """The no-LLM-call fallback branch reports honest zero usage — no
    ledger row should even be written by a caller in that case."""
    monkeypatch.setattr(archetype_mod, "_load_archetypes", lambda: {})
    result, usage = archetype_mod.classify_archetype_with_usage({"title": "x"})

    assert result["archetype"] == ""
    assert usage == llm.CompletionUsage(input_tokens=0, output_tokens=0)
