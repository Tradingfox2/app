"""Shared Motor client for the API and console scripts.

`server.py` re-exports `client` and `db`. Scripts such as
`seed_scripts/grant_staff.py` import this module directly so they do not load
the FastAPI app (and the router import that needs `staff` while `staff` is
still loading).
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
db_name = os.environ.get("DB_NAME", "ironflow")

# tz_aware: Mongo stores UTC; without this, reads come back naive and break
# arithmetic against now() (timezone-aware) — e.g. muscle recovery ages.
def _make_client():
    try:
        import truststore
        truststore.extract_from_ssl()
        try:
            return AsyncIOMotorClient(mongo_url, tz_aware=True)
        finally:
            truststore.inject_into_ssl()
    except ImportError:
        return AsyncIOMotorClient(mongo_url, tz_aware=True)


client = _make_client()
db = client[db_name]
