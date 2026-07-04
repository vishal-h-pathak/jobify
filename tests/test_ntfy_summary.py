"""tests/test_ntfy_summary.py — H7: jobify.notify.send_ntfy_summary.

Mirrors the mocking style of tests/test_morning_digest.py (the existing
Resend-function tests): monkeypatch.setenv/delenv for the env-driven
secret, and monkeypatch.setattr(notify.requests, "post", ...) for the
HTTP call. Policy pins: unset NTFY_TOPIC skips silently (no print, no
HTTP), a set topic POSTs the raw line as the body to
https://ntfy.sh/{topic}, and a non-2xx response prints a failure line
and returns False.
"""

from __future__ import annotations

import pytest

from jobify import notify


@pytest.fixture
def no_http(monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("requests.post must not be called")

    monkeypatch.setattr(notify.requests, "post", _boom)


def test_missing_topic_skips_silently(no_http, monkeypatch, capsys):
    monkeypatch.delenv("NTFY_TOPIC", raising=False)
    assert notify.send_ntfy_summary("done. discovery: users=2") is False
    assert capsys.readouterr().out == ""


def test_empty_topic_skips_silently(no_http, monkeypatch, capsys):
    monkeypatch.setenv("NTFY_TOPIC", "")
    assert notify.send_ntfy_summary("done. discovery: users=2") is False
    assert capsys.readouterr().out == ""


def test_success_posts_line_as_raw_body(monkeypatch):
    sent: list[dict] = []

    class _Resp:
        status_code = 200
        text = "ok"

    def _post(url, data=None, timeout=None):
        sent.append({"url": url, "data": data, "timeout": timeout})
        return _Resp()

    monkeypatch.setattr(notify.requests, "post", _post)
    monkeypatch.setenv("NTFY_TOPIC", "jobify-hosted-cycles")

    line = "done. discovery: users=2 fetched=5 | pool_spend=$1.23/$100.00"
    assert notify.send_ntfy_summary(line) is True

    assert len(sent) == 1
    assert sent[0]["url"] == "https://ntfy.sh/jobify-hosted-cycles"
    assert sent[0]["data"] == line.encode("utf-8")


def test_failure_response_prints_and_returns_false(monkeypatch, capsys):
    class _Resp:
        status_code = 500
        text = "server error"

    def _post(url, data=None, timeout=None):
        return _Resp()

    monkeypatch.setattr(notify.requests, "post", _post)
    monkeypatch.setenv("NTFY_TOPIC", "jobify-hosted-cycles")

    assert notify.send_ntfy_summary("done.") is False
    printed = capsys.readouterr().out
    assert "ntfy failed 500" in printed
    assert "server error" in printed
