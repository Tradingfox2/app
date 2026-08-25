"""Emergent Object Storage helpers (private lab-report files)."""
import os

import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "ironflow"

storage_key = None


def init_storage():
    """Call once at startup; idempotent."""
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def _reset_and_retry(fn):
    global storage_key
    storage_key = None
    init_storage()
    return fn()


def put_object(path: str, data: bytes, content_type: str) -> dict:
    def _do():
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()

    try:
        return _do()
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 503:
            return _reset_and_retry(_do)
        raise


def get_object(path: str) -> tuple[bytes, str]:
    def _do():
        key = init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

    try:
        return _do()
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 503:
            return _reset_and_retry(_do)
        raise
