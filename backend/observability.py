"""Error reporting and process logs.

Both stay quiet unless someone turns them on. An empty ``SENTRY_DSN`` never
calls ``sentry_sdk.init``, so the process boots with no client and no
transport. Pytest is treated the same way even when a DSN is present in the
environment, so the suite cannot ship events.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")
# 5xx only. A 4xx is the API's own answer, not a crash to report.
_FAILED_REQUEST_STATUS_CODES = set(range(500, 600))


def dsn() -> str:
    return os.environ.get("SENTRY_DSN", "").strip()


def under_test() -> bool:
    """True during pytest, including collection before a test starts."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    return "pytest" in sys.modules


def before_send(
    event: dict[str, Any], _hint: dict[str, Any]
) -> dict[str, Any] | None:
    if under_test():
        return None
    return event


def init_sentry() -> None:
    """Start the SDK, or do nothing when it must stay off."""
    if under_test() or not dsn():
        return
    sentry_sdk.init(
        dsn=dsn(),
        send_default_pii=False,
        traces_sample_rate=0.0,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=before_send,
        integrations=[
            StarletteIntegration(
                failed_request_status_codes=_FAILED_REQUEST_STATUS_CODES
            ),
            FastApiIntegration(
                failed_request_status_codes=_FAILED_REQUEST_STATUS_CODES
            ),
        ],
    )


class JsonFormatter(logging.Formatter):
    """One JSON object per line, including uvicorn's access-log arguments."""

    def format(self, record: logging.LogRecord) -> str:
        try:
            message = record.getMessage()
        except (TypeError, ValueError):
            message = str(record.msg)
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(
                record.created, timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": message,
        }
        payload.update(_access_fields(record))
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def _access_fields(record: logging.LogRecord) -> dict[str, Any]:
    """Uvicorn 0.25 logs access as five %-args, not as record attributes."""
    if record.name != "uvicorn.access":
        return {}
    args = record.args
    if not isinstance(args, tuple) or len(args) != 5:
        return {}
    client_addr, method, path, http_version, status_code = args
    return {
        "client_addr": client_addr,
        "method": method,
        "path": path,
        "http_version": http_version,
        "status_code": status_code,
    }


def configure_logging() -> None:
    """JSON on the root logger and on any uvicorn handlers already attached.

    Uvicorn installs its own handlers before importing the app. Replacing
    their formatter covers ``uvicorn server:app`` without ``--log-config``.
    The image and CI pass ``backend/log_config.json`` so the lines before
    import are JSON too.
    """
    formatter = JsonFormatter()
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    already_json = any(
        isinstance(handler.formatter, JsonFormatter)
        for handler in root.handlers
    )
    if not already_json:
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        root.addHandler(handler)
    for name in _UVICORN_LOGGERS:
        named = logging.getLogger(name)
        named.setLevel(logging.INFO)
        for handler in named.handlers:
            handler.setFormatter(formatter)
