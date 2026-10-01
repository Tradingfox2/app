"""Readiness probe and the grant_staff import cycle.

These tests do not need a live MongoDB. /api/health is called directly, and
grant_staff is run with no arguments (or a rejected role) so it exits before
it opens a connection.
"""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

from fastapi.responses import JSONResponse

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "deploy-health-test-secret")

import ai  # noqa: E402
import server  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


class PingDb:
    def __init__(self, error: BaseException | None = None):
        self.error = error

    async def command(self, name):
        assert name == "ping"
        if self.error is not None:
            raise self.error
        return {"ok": 1}


def test_root_stays_a_liveness_probe():
    assert asyncio.run(server.root()) == {"service": "ironflow", "status": "ok"}


def test_health_route_is_registered():
    paths = {getattr(route, "path", None) for route in server.app.routes}
    assert "/api/health" in paths
    assert "/api/" in paths


def test_health_reports_mongo_and_a_configured_provider(monkeypatch):
    monkeypatch.setattr(server, "db", PingDb())
    monkeypatch.setattr(ai, "LLM_PROVIDER", "anthropic")
    monkeypatch.setattr(ai, "ANTHROPIC_API_KEY", "test-key")
    body = asyncio.run(server.health())
    assert body == {
        "status": "ok",
        "mongo": True,
        "ai_configured": True,
        "ai_provider": "anthropic",
    }


def test_health_does_not_treat_provider_none_as_configured(monkeypatch):
    monkeypatch.setattr(server, "db", PingDb())
    monkeypatch.setattr(ai, "LLM_PROVIDER", "none")
    monkeypatch.setattr(ai, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(ai, "OPENROUTER_API_KEY", "")
    body = asyncio.run(server.health())
    assert body["mongo"] is True
    assert body["ai_configured"] is False
    assert body["status"] == "ok"


def test_explicit_ollama_is_configured_without_a_network_call(monkeypatch):
    monkeypatch.setattr(ai, "LLM_PROVIDER", "ollama")
    assert ai.provider_configured() is True


def test_auto_with_no_keys_is_not_configured(monkeypatch):
    monkeypatch.setattr(ai, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(ai, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(ai, "OPENROUTER_API_KEY", "")
    assert ai.provider_configured() is False


def test_health_mongo_down_is_503_and_hides_the_driver_error(monkeypatch):
    monkeypatch.setattr(server, "db", PingDb(error=ConnectionError("secret-host.example")))
    monkeypatch.setattr(ai, "LLM_PROVIDER", "none")
    monkeypatch.setattr(ai, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(ai, "OPENROUTER_API_KEY", "")
    response = asyncio.run(server.health())
    assert isinstance(response, JSONResponse)
    assert response.status_code == 503
    body = json.loads(response.body)
    assert body["status"] == "unavailable"
    assert body["mongo"] is False
    assert body["ai_configured"] is False
    assert b"secret-host" not in response.body


def test_requirements_drop_unused_stacks_and_keep_boto3():
    text = (BACKEND / "requirements.txt").read_text()
    for name in (
        "emergentintegrations",
        "litellm",
        "pandas",
        "numpy",
        "google-genai",
        "google-generativeai",
        "googleapis-common-protos",
        "google-auth",
    ):
        assert name not in text
    assert "boto3==" in text


def _run_grant_staff(*args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MONGO_URL"] = "mongodb://127.0.0.1:1"
    env.setdefault("DB_NAME", "ironflow")
    return subprocess.run(
        [sys.executable, "seed_scripts/grant_staff.py", *args],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_grant_staff_prints_usage_without_the_import_cycle():
    proc = _run_grant_staff()
    combined = proc.stdout + proc.stderr
    assert proc.returncode == 2
    assert "alice@example.com" in proc.stdout
    assert "ImportError" not in combined
    assert "partially initialized" not in combined


def test_grant_staff_rejects_an_unknown_role_before_connecting():
    proc = _run_grant_staff("person@example.com", "owner")
    combined = proc.stdout + proc.stderr
    assert proc.returncode == 2
    assert "Role must be one of" in proc.stdout
    assert "support" in proc.stdout
    assert "ImportError" not in combined
    assert "partially initialized" not in combined
