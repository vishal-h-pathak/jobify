"""jobify.hosted.feeders._ats_url — parse an ATS slug straight out of a
known, public-facing ATS URL (HUNT2 P2 S4). Shared by the HN-extraction
and SerpAPI-dork feeders — both need "the slug is already in the URL"
parsing, zero HTTP, for their highest-confidence evidence path.

Deliberately narrower than `jobify.shared.ats_detect.detect_ats`: that
function also matches non-host signals (e.g. an `ashby_jid` query param
on a company's own careers page embedding an Ashby widget) which have no
parseable slug in the URL PATH at all. This module only recognizes the
three ATS's own public board hosts, where the slug is always the first
path segment — the API-host forms (`boards-api.greenhouse.io`,
`api.lever.co`, `api.ashbyhq.com`) are intentionally out of scope too:
feeders only ever encounter user-facing links (an HN commenter's apply
URL, a Google-indexed result), never raw API endpoints.
"""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

_SLUG_RE = re.compile(r"^/([a-z0-9][a-z0-9-]*)", re.IGNORECASE)


def parse_ats_slug(url: str) -> tuple[Optional[str], Optional[str]]:
    """Return `(ats, slug)` parsed from a known ATS public board URL's
    path, or `(None, None)` if the URL isn't one of the three recognized
    hosts or has no parseable leading path segment.
    """
    if not url:
        return None, None
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""

    if "greenhouse.io" in host:
        ats = "greenhouse"
    elif "lever.co" in host:
        ats = "lever"
    elif "ashbyhq.com" in host:
        ats = "ashby"
    else:
        return None, None

    match = _SLUG_RE.match(path)
    if not match:
        return None, None
    return ats, match.group(1).lower()
