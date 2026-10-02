"""Sentry stays off without a DSN and during pytest. Uvicorn logs are JSON."""
from __future__ import annotations

import json
import logging
import logging.config
import sys
from pathlib import Path

import sentry_sdk

import observability

_LOG_CONFIG = Path(__file__).resolve().parents[1] / "log_config.json"
_DSN = "https://public@o1.ingest.sentry.io/1"


def test_blank_dsn_does_not_init(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "   ")
    monkeypatch.setattr(observability, "under_test", lambda: False)
    calls: list[dict] = []

    def fake_init(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(observability.sentry_sdk, "init", fake_init)
    observability.init_sentry()
    assert calls == []


def test_pytest_does_not_init_even_with_a_dsn(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", _DSN)
    calls: list[dict] = []

    def fake_init(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(observability.sentry_sdk, "init", fake_init)
    observability.init_sentry()
    assert calls == []
    assert observability.under_test() is True


def test_sdk_stays_inactive_during_pytest(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", _DSN)
    observability.init_sentry()
    assert sentry_sdk.get_client().is_active() is False


def test_configured_init_passes_the_dsn_and_drops_test_events(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", _DSN)
    monkeypatch.setattr(observability, "under_test", lambda: False)
    captured: dict = {}

    def fake_init(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(observability.sentry_sdk, "init", fake_init)
    observability.init_sentry()
    assert captured["dsn"] == _DSN
    assert captured["send_default_pii"] is False
    assert captured["traces_sample_rate"] == 0.0
    assert captured["max_request_body_size"] == "never"
    monkeypatch.setattr(observability, "under_test", lambda: True)
    assert captured["before_send"]({"message": "nope"}, {}) is None


def test_access_line_is_one_json_object():
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "%s %s HTTP/%s" %d',
        args=("127.0.0.1:9", "GET", "/api/health", "1.1", 200),
        exc_info=None,
    )
    payload = json.loads(observability.JsonFormatter().format(record))
    assert payload["logger"] == "uvicorn.access"
    assert payload["method"] == "GET"
    assert payload["path"] == "/api/health"
    assert payload["status_code"] == 200
    assert payload["message"] == '127.0.0.1:9 - "GET /api/health HTTP/1.1" 200'
    assert "\n" not in observability.JsonFormatter().format(record)


def test_exception_is_a_json_field():
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        record = logging.LogRecord(
            name="ironflow",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="request failed",
            args=(),
            exc_info=sys.exc_info(),
        )
    payload = json.loads(observability.JsonFormatter().format(record))
    assert "RuntimeError: boom" in payload["exception"]


def test_uvicorn_log_config_uses_the_json_formatter(capsys):
    logging.config.dictConfig(json.loads(_LOG_CONFIG.read_text()))
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/%s" %d',
        "127.0.0.1:9",
        "GET",
        "/api/",
        "1.1",
        200,
    )
    captured = capsys.readouterr()
    line = (captured.out or captured.err).strip().splitlines()[-1]
    payload = json.loads(line)
    assert payload["path"] == "/api/"
    assert payload["status_code"] == 200
