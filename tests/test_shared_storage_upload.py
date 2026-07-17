"""tests/test_shared_storage_upload.py — jobify.shared.storage.upload_bytes.

V3B Task 5a: the hosted tailor worker (Task 5b) needs a generic upload
primitive symmetric with this module's existing ``download_bytes`` — a
different path shape (``{user_id}/{posting_id}/{filename}``) than the
single-user ``jobify.tailor.storage.upload_pdf``'s ``{job_id}/{kind}.pdf``,
which is outside this module's ownership fence.

Fully mocked at the ``_get_client()`` seam — no network, no real Supabase
SDK required to run.
"""

from __future__ import annotations

from jobify.shared import storage


class _FakeStorageBucket:
    """Records upload()/remove() calls; upload() can be scripted to raise
    once (simulating an SDK that throws on a duplicate key rather than
    honoring ``upsert``) before succeeding on retry."""

    def __init__(self, raise_on_first_upload: bool = False):
        self.uploads: list[dict] = []
        self.removed: list[list[str]] = []
        self._raise_on_first_upload = raise_on_first_upload
        self._upload_calls = 0

    def upload(self, *, path: str, file: bytes, file_options: dict):
        self._upload_calls += 1
        if self._raise_on_first_upload and self._upload_calls == 1:
            raise RuntimeError("duplicate key value violates unique constraint")
        self.uploads.append({"path": path, "file": file, "file_options": file_options})

    def remove(self, paths: list[str]):
        self.removed.append(paths)


class _FakeStorageNamespace:
    def __init__(self, bucket: _FakeStorageBucket):
        self._bucket = bucket

    def from_(self, bucket_name: str):
        assert bucket_name == storage.BUCKET
        return self._bucket


class _FakeClient:
    def __init__(self, bucket: _FakeStorageBucket):
        self.storage = _FakeStorageNamespace(bucket)


def test_upload_bytes_uses_upsert_semantics(monkeypatch):
    bucket = _FakeStorageBucket()
    monkeypatch.setattr(storage, "_get_client", lambda: _FakeClient(bucket))

    storage.upload_bytes("user-1/posting-1/resume.pdf", b"%PDF fake", "application/pdf")

    assert len(bucket.uploads) == 1
    call = bucket.uploads[0]
    assert call["path"] == "user-1/posting-1/resume.pdf"
    assert call["file"] == b"%PDF fake"
    assert call["file_options"] == {
        "content-type": "application/pdf",
        "upsert": "true",
    }
    assert bucket.removed == []


def test_upload_bytes_falls_back_to_remove_then_upload_on_upsert_failure(monkeypatch):
    bucket = _FakeStorageBucket(raise_on_first_upload=True)
    monkeypatch.setattr(storage, "_get_client", lambda: _FakeClient(bucket))

    storage.upload_bytes("user-2/posting-2/claims.json", b'{"dropped": []}', "application/json")

    # First (upsert) attempt raised and isn't recorded as a successful upload;
    # remove-then-upload kicked in and the retry succeeded.
    assert bucket.removed == [["user-2/posting-2/claims.json"]]
    assert len(bucket.uploads) == 1
    call = bucket.uploads[0]
    assert call["path"] == "user-2/posting-2/claims.json"
    assert call["file"] == b'{"dropped": []}'
    # Retry omits the upsert flag, matching jobify.tailor.storage.upload_pdf's pattern.
    assert call["file_options"] == {"content-type": "application/json"}


def test_upload_bytes_content_type_passthrough_for_arbitrary_kinds(monkeypatch):
    """Not hard-coded to PDFs — the hosted worker uploads 6 different kinds
    (resume.pdf, cover_letter.pdf, cover_letter.txt, tailored.json,
    claims.json, render_meta.json) to the same bucket."""
    bucket = _FakeStorageBucket()
    monkeypatch.setattr(storage, "_get_client", lambda: _FakeClient(bucket))

    storage.upload_bytes("u/p/cover_letter.txt", b"Dear hiring team,", "text/plain")

    assert bucket.uploads[0]["file_options"]["content-type"] == "text/plain"
