"""sources/remote_infer.py — shared tri-state remote-inference helper
(P0.2, HUNT2 session 47).

Every fetcher used to either discard remote signal entirely (JSearch) or
never look for one (Greenhouse, Ashby) — `postings.remote` stayed NULL for
the whole pool, so the scorer's location gate (and now P0.7's
location-tier ranking) had nothing to work with for any non-remote-only
source. This module centralizes the inference so every fetcher reports
the same tri-state signal the same way:

    True  — remote (structured field says so, or the location text does)
    False — onsite/hybrid (location text says so)
    None  — unknown/ambiguous — NEVER coerced to False. "We don't know"
            and "not remote" are different signals to the scorer: a
            `None` posting is P0.7 location-tier 2 (ambiguous), a `False`
            one is tier 1 or 3 depending on whether it matches the user's
            base metro.

Sources that are remote-only by construction (RemoteOK, and — if ever
wired — We Work Remotely / Remotive) don't need this helper at all; they
hardcode `remote=True` directly at the fetcher, since every posting they
carry already is remote by definition.
"""

from __future__ import annotations

import re
from typing import Optional

_REMOTE_RE = re.compile(r"(?i)\b(remote|anywhere|distributed|work[\s-]from[\s-]home|wfh)\b")
_ONSITE_HINT_RE = re.compile(r"(?i)\b(on-?site|in-?office|in-person)\b")

# Common structured-field names across ATS/aggregator raw payloads —
# checked first, before falling back to the location-text regex. Only
# JSearch has one of these today (`job_is_remote`, handled directly by
# its own fetcher before this function is ever called); this list is
# defensive for future sources that expose an equivalent field.
_STRUCTURED_REMOTE_KEYS = ("remote", "is_remote", "isRemote")


def infer_remote(location_str: Optional[str], raw: Optional[dict] = None) -> Optional[bool]:
    """Best-effort tri-state remote inference: `True` / `False` / `None`.

    Checks `raw` (the source's original payload, if the caller has one)
    for an explicit structured field first, then pattern-matches
    `location_str`. Returns `None` — never `False` — when neither signal
    is present; callers must not treat `None` as "not remote".
    """
    if isinstance(raw, dict):
        for key in _STRUCTURED_REMOTE_KEYS:
            val = raw.get(key)
            if isinstance(val, bool):
                return val

    text = (location_str or "").strip()
    if not text:
        return None
    if _REMOTE_RE.search(text):
        return True
    if _ONSITE_HINT_RE.search(text):
        return False
    return None
