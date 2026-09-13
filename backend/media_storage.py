"""User media (progress photos, training clips).

Backend is chosen by env: S3-compatible object storage when MEDIA_S3_BUCKET is
set (Cloudflare R2 / Backblaze B2 / AWS S3 — cheapest tiers have free 10 GB),
otherwise local disk under backend/media served by the API. Same public URL
contract either way, so switching later is config-only.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

MEDIA_ROOT = Path(__file__).parent / "media"
S3_BUCKET = os.environ.get("MEDIA_S3_BUCKET", "")
S3_ENDPOINT = os.environ.get("MEDIA_S3_ENDPOINT", "")
PUBLIC_BASE = os.environ.get("MEDIA_PUBLIC_BASE_URL", "").rstrip("/")

IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
VIDEO_TYPES = {"video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 120 * 1024 * 1024
_SAFE_KEY = re.compile(r"^[a-zA-Z0-9/_.-]+$")

_MAGIC = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
    "video/mp4": (b"ftyp",),
    "video/quicktime": (b"ftyp", b"moov", b"mdat", b"wide"),
    "video/webm": (b"\x1a\x45\xdf\xa3",),
}


def s3_enabled() -> bool:
    return bool(S3_BUCKET)


def sniff_ok(content_type: str, head: bytes) -> bool:
    """Reject files whose bytes do not match the declared type (mislabelled uploads)."""
    markers = _MAGIC.get(content_type)
    if not markers:
        return False
    window = head[:16]
    return any(marker in window for marker in markers)


def kind_for(content_type: str) -> str | None:
    if content_type in IMAGE_TYPES:
        return "image"
    if content_type in VIDEO_TYPES:
        return "video"
    return None


def extension_for(content_type: str) -> str:
    return IMAGE_TYPES.get(content_type) or VIDEO_TYPES[content_type]


def store(key: str, data: bytes, content_type: str) -> str:
    """Persist bytes under key and return a public URL."""
    if not _SAFE_KEY.match(key) or ".." in key:
        raise ValueError("Unsafe media key")
    if s3_enabled():
        import boto3  # optional dependency, only needed with object storage

        client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT or None,
            aws_access_key_id=os.environ.get("MEDIA_S3_ACCESS_KEY"),
            aws_secret_access_key=os.environ.get("MEDIA_S3_SECRET_KEY"),
            region_name=os.environ.get("MEDIA_S3_REGION", "auto"),
        )
        client.put_object(Bucket=S3_BUCKET, Key=key, Body=data, ContentType=content_type,
                          CacheControl="public, max-age=31536000, immutable")
        return f"{PUBLIC_BASE}/{key}" if PUBLIC_BASE else f"{S3_ENDPOINT.rstrip('/')}/{S3_BUCKET}/{key}"
    target = MEDIA_ROOT / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return f"{PUBLIC_BASE}/api/media/files/{key}" if PUBLIC_BASE else f"/api/media/files/{key}"
