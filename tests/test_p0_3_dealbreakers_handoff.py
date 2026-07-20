"""tests/test_p0_3_dealbreakers_handoff.py — P0.3 (HUNT2 session 47).

The planning doc (planning/HUNT2_SOURCES.md, Agent B finding B#6) claimed
"dealbreakers never reach the rubric compiler." A read-only trace during
this session (disqualifiers.yml -> load_disqualifiers_text -> fanout.py's
_ensure_rubric -> compile_rubric -> rubric.py's disqualifier short-circuit
-> fanout.py's stage-2 continue) found the wiring fully intact and dated
2026-07-03, well before this session — the finding appears stale, not a
real bug. This test pins the acceptance criteria P0.3 asks for directly
against the real `jobify.hosted.fanout` ladder (not a synthetic fixture),
so a future regression here is caught rather than re-diagnosed from
scratch:

  1. A compiled rubric for a test profile contains its dealbreakers.
  2. A synthetic posting violating one is disqualified BEFORE the LLM
     stage (stage 4 never runs for it — zero tokens spent on it).

No production code changes were needed for P0.3 this session (see the
session report) — this is a pin, not a fix.
"""

from __future__ import annotations

import json
from pathlib import Path

from jobify import db
from jobify.hosted import fanout
from jobify.shared import llm
from jobify.shared.llm import CompletionUsage

_DEALBREAKER_TEXT = "Crypto / Web3 / trading products"


def _profile_dir(tmp_path: Path) -> Path:
    d = tmp_path / "user-a"
    d.mkdir()
    (d / "thesis.md").write_text("Wants platform engineering roles.", encoding="utf-8")
    (d / "portals.yml").write_text("", encoding="utf-8")
    (d / "profile.yml").write_text(
        "what_he_is_looking_for:\n  tier_1:\n    label: Platform engineering\n",
        encoding="utf-8",
    )
    (d / "disqualifiers.yml").write_text(
        f"hard_disqualifiers:\n  - {_DEALBREAKER_TEXT}\nsoft_concerns: []\n",
        encoding="utf-8",
    )
    return d


def _posting(pid: str, title: str, description: str) -> dict:
    return {"id": pid, "title": title, "company": "Acme", "location": "Remote", "description": description}


def test_dealbreaker_reaches_compiled_rubric_and_disqualifies_before_llm_stage(
    tmp_path, monkeypatch,
):
    d = _profile_dir(tmp_path)
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: None)  # force a fresh compile
    compiled: dict = {}
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, rubric: compiled.update(rubric))
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    monkeypatch.setattr(db, "get_global_month_to_date_spend", lambda: 0.0)
    monkeypatch.setattr(db, "get_api_key_ciphertext", lambda uid: None)

    postings = [
        _posting("p-crypto", "Senior Platform Engineer, Web3",
                 "Own our crypto trading platform end-to-end."),
        _posting("p-real", "Senior Platform Engineer",
                 "Own services end to end across a distributed systems stack."),
    ]
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: postings)

    compiled_rubric = {
        "rubric_version": 1,
        "term_groups": [{"group": "core", "weight": 1.0, "terms": ["engineer"]}],
        "disqualifiers": [{"pattern": "(?i)crypto|web3", "reason": _DEALBREAKER_TEXT}],
        "gates": {}, "tier_hints": [],
    }

    def _fake_complete(*, system, prompt, model, max_tokens):
        if model.startswith("claude-sonnet"):
            # The handoff under test: disqualifiers.yml's text must
            # actually reach the compiler prompt.
            assert _DEALBREAKER_TEXT in prompt, (
                "dealbreakers.yml content did not reach the rubric compiler prompt"
            )
            return (json.dumps(compiled_rubric), CompletionUsage(input_tokens=50, output_tokens=30))
        # Stage 4 (haiku) — must NEVER be reached for the disqualified
        # posting. It's fine for p-real to get here.
        return (json.dumps({"score": 0.6, "reason": "solid fit"}), CompletionUsage(input_tokens=10, output_tokens=5))

    monkeypatch.setattr(llm, "complete_with_usage", _fake_complete)

    upserts: list[tuple] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append((pid, kw)))

    counters = fanout.run_fanout_cycle(["user-a"])

    # 1. Compiled rubric for this profile contains its dealbreaker.
    assert compiled["disqualifiers"]
    assert any(_DEALBREAKER_TEXT in dq["reason"] for dq in compiled["disqualifiers"])

    # 2. The synthetic posting violating it is disqualified before stage 4.
    disqualified_write = next(kw for pid, kw in upserts if pid == "p-crypto")
    assert disqualified_write["status"] == "rejected_rubric"
    assert "disqualified" in disqualified_write["reject_reason"]

    # p-real proves the harness is real (stage 4 does run for a survivor);
    # p-crypto never contributing to stage4_calls proves the disqualified
    # posting never reached it.
    assert counters["stage4_calls"] == 1
    surfaced_write = next(kw for pid, kw in upserts if pid == "p-real" and kw.get("status") == "surfaced")
    assert surfaced_write["llm_score"] == 0.6
