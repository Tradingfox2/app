"""Missing local media redirects to object storage instead of 404."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

import media_storage


def _client(tmp_path, monkeypatch, bucket="b", base="https://pub.example.r2.dev"):
    monkeypatch.setattr(media_storage, "S3_BUCKET", bucket)
    monkeypatch.setattr(media_storage, "PUBLIC_BASE", base)
    monkeypatch.delenv("MEDIA_S3_BUCKET", raising=False)
    monkeypatch.delenv("MEDIA_PUBLIC_BASE_URL", raising=False)
    (tmp_path / "exercises").mkdir()
    (tmp_path / "exercises" / "local.jpg").write_bytes(b"\xff\xd8\xffdata")
    app = FastAPI()
    app.mount("/api/media/files", media_storage.MediaFiles(tmp_path), name="media")
    return TestClient(app, follow_redirects=False)


def test_local_file_served(tmp_path, monkeypatch):
    r = _client(tmp_path, monkeypatch).get("/api/media/files/exercises/local.jpg")
    assert r.status_code == 200 and r.content.startswith(b"\xff\xd8\xff")


def test_missing_file_redirects_to_public_base(tmp_path, monkeypatch):
    r = _client(tmp_path, monkeypatch).get("/api/media/files/users/u1/p.jpg")
    assert r.status_code == 302
    assert r.headers["location"] == "https://pub.example.r2.dev/users/u1/p.jpg"


def test_missing_file_404_without_object_storage(tmp_path, monkeypatch):
    r = _client(tmp_path, monkeypatch, bucket="", base="").get("/api/media/files/x.jpg")
    assert r.status_code == 404