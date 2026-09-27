"""Smoke: write one user jpeg and one admin png through media_storage.

`media_storage.store` is synchronous, and this tree does not depend on
pytest-asyncio, so the test is a plain function. It does not open Mongo.

Run from backend/:
  python -m pytest tests/test_dual_media_smoke.py -q
"""
from __future__ import annotations

import media_storage


def test_user_and_admin_media_land_on_disk(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_S3_BUCKET", "")
    monkeypatch.setattr(media_storage, "MEDIA_ROOT", tmp_path)
    monkeypatch.setattr(media_storage, "S3_BUCKET", "")
    monkeypatch.setattr(media_storage, "PUBLIC_BASE", "")

    # Minimal JPEG + PNG magic so a later sniff_ok check would pass.
    jpeg = b"\xff\xd8\xff" + b"\x00" * 64
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

    user_key = "users/user-1/m1.jpg"
    admin_key = "admin/staff-1/a1.png"
    user_url = media_storage.store(user_key, jpeg, "image/jpeg")
    admin_url = media_storage.store(admin_key, png, "image/png")

    user_path = tmp_path / user_key
    admin_path = tmp_path / admin_key
    assert user_path.is_file()
    assert admin_path.is_file()
    assert user_path.read_bytes() == jpeg
    assert admin_path.read_bytes() == png
    assert user_url.endswith(user_key)
    assert admin_url.endswith(admin_key)
