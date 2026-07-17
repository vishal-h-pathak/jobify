"""
jobify.shared.storage — Supabase Storage download helpers shared by hunt /
tailor / submit.

Hosts the unified ``download_to_tmp`` and ``download_bytes`` (formerly
duplicated across job-applicant/storage.py and job-submitter/storage.py with
divergent bodies). The unified body adopts:

  - the applicant version's defensive empty-download check + try/except
    cleanup (resume PDFs are user-visible; silent empty downloads would
    corrupt a submission)
  - the submitter version's optional ``suffix`` parameter and debug log

``upload_bytes`` (V3B Task 5a) is the one generic upload primitive here — for
the hosted worker's ``{user_id}/{posting_id}/{filename}`` path shape. Deletes,
signed-URL generation, and the single-user ``{job_id}/{kind}.pdf``-keyed
upload remain in their original modules (``jobify.tailor.storage``).

The Supabase client is created lazily inside ``_get_client`` so importing this
module does not require ``supabase`` to be installed — only calling a function
does. This keeps ``pytest --collect-only`` working in environments where the
runtime SDK isn't installed.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("jobify.shared.storage")

BUCKET = "job-materials"

_client: Any = None


def _get_client() -> Any:
    """Return a memoized Supabase service-role client; create on first call."""
    global _client
    if _client is not None:
        return _client

    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY", "")
    if not (url and key):
        raise RuntimeError(
            "Supabase storage client not configured: set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) in env."
        )

    # Lazy import so `pytest --collect-only` works without the supabase SDK.
    from supabase import create_client  # type: ignore[import-not-found]

    _client = create_client(url, key)
    return _client


def download_bytes(storage_path: str) -> bytes:
    """Return the raw bytes at ``storage_path`` without touching the filesystem."""
    return _get_client().storage.from_(BUCKET).download(storage_path)


def upload_bytes(storage_path: str, data: bytes, content_type: str) -> None:
    """Upload ``data`` to ``storage_path`` in the ``job-materials`` bucket
    (``BUCKET``), overwriting any existing object (upsert semantics).

    The hosted tailor worker (Task 5b) uses this for its
    ``{user_id}/{posting_id}/{filename}`` path shape — different from the
    single-user ``jobify.tailor.storage.upload_pdf``'s ``{job_id}/{kind}.pdf``
    shape, which is outside this module's ownership fence. Mirrors that
    function's upsert-then-remove-and-retry pattern (older SDKs throw on a
    duplicate key rather than honoring ``upsert``), adapted to this module's
    lazy client (``_get_client()``) rather than the eager one
    ``jobify.tailor.storage`` uses.
    """
    storage = _get_client().storage.from_(BUCKET)
    try:
        storage.upload(
            path=storage_path,
            file=data,
            file_options={
                "content-type": content_type,
                "upsert": "true",
            },
        )
    except Exception as e:
        logger.debug(
            "upload with upsert failed for %s (%r); trying remove-then-upload",
            storage_path, e,
        )
        try:
            storage.remove([storage_path])
        except Exception:
            pass
        storage.upload(
            path=storage_path,
            file=data,
            file_options={"content-type": content_type},
        )
    logger.info("Uploaded %s (%d bytes) to bucket=%s", storage_path, len(data), BUCKET)


def download_to_tmp(storage_path: str, suffix: Optional[str] = None) -> Path:
    """Download a Supabase Storage object to a NamedTemporaryFile.

    Unified body adopted in PR-1 (replaces divergent copies under
    job-applicant/storage.py and job-submitter/storage.py):

      - raises RuntimeError on empty data (was silent in submitter version)
      - cleans up the orphaned temp file if the write fails (was missing in
        submitter version)
      - ``suffix`` defaults to ``Path(storage_path).suffix`` then ``.pdf``,
        so callers no longer need to pass it explicitly (was required in
        submitter version)

    Caller is responsible for deleting the file when done (or letting the OS
    reclaim ``/tmp``).
    """
    data = _get_client().storage.from_(BUCKET).download(storage_path)
    if not data:
        raise RuntimeError(f"Empty download for storage_path={storage_path}")

    suffix = suffix or Path(storage_path).suffix or ".pdf"
    fd, name = tempfile.mkstemp(prefix="jobify_", suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
    except Exception:
        os.unlink(name)
        raise
    logger.debug("downloaded %s -> %s (%d bytes)", storage_path, name, len(data))
    return Path(name)
