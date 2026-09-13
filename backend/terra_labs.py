"""Terra Lab Reports transport, webhook verification, and result mapping."""
from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timezone
from typing import Any

import httpx


TERMINAL_STATUSES = {"sent", "partially_sent", "failed", "cancelled", "deleted"}


def verify_webhook_signature(
    payload: bytes,
    signature_header: str | None,
    signing_secret: str,
    *,
    now_timestamp: int | None = None,
    tolerance_seconds: int = 300,
) -> bool:
    """Verify Terra's timestamped HMAC-SHA256 signature against raw bytes."""
    if not signature_header or not signing_secret:
        return False

    timestamp: str | None = None
    signatures: list[str] = []
    for part in signature_header.split(","):
        key, separator, value = part.strip().partition("=")
        if not separator:
            continue
        if key == "t":
            timestamp = value
        elif key == "v1":
            signatures.append(value)

    if not timestamp or not signatures:
        return False
    try:
        signed_at = int(timestamp)
    except ValueError:
        return False

    current = int(time.time()) if now_timestamp is None else now_timestamp
    if abs(current - signed_at) > tolerance_seconds:
        return False

    message = timestamp.encode("ascii") + b"." + payload
    expected = hmac.new(signing_secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


async def upload_report(
    *,
    base_url: str,
    dev_id: str,
    api_key: str,
    reference_id: str,
    filename: str,
    mime: str,
    data: bytes,
) -> dict[str, Any]:
    """Submit one report to Terra and return its asynchronous upload handle."""
    url = f"{base_url.rstrip('/')}/v2/reports"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            url,
            params={"reference_id": reference_id},
            headers={"dev-id": dev_id, "x-api-key": api_key},
            files={"file": (filename, data, mime)},
        )
    if response.status_code != 202:
        detail = response.text[:500]
        try:
            detail = response.json().get("detail") or detail
        except ValueError:
            pass
        raise RuntimeError(f"Terra upload failed ({response.status_code}): {detail}")
    body = response.json()
    if not body.get("upload_id"):
        raise RuntimeError("Terra upload response did not include upload_id")
    return body


def parse_terra_date(value: str | None) -> datetime:
    """Parse a report date without substituting webhook receipt time when present."""
    if not value:
        return datetime.now(timezone.utc)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def map_result(result: dict[str, Any], *, report_id: str, session_id: str, user_id: str) -> dict[str, Any]:
    """Preserve Terra's layered result while exposing legacy trend fields."""
    source = result.get("source") or {}
    biomarker = result.get("biomarker") or {}
    measurement = result.get("measurement") or {}
    interpretation = result.get("interpretation") or {}
    ranges = result.get("reference_ranges") or []
    applied_range = interpretation.get("applied_range") or {}
    measured_at = parse_terra_date(source.get("collection_date"))

    value: float | None = None
    bound_operator: str | None = None
    if measurement.get("type") == "numeric" and isinstance(measurement.get("numeric"), (int, float)):
        value = float(measurement["numeric"])
    elif measurement.get("type") == "bounded":
        bounded = measurement.get("bounded") or {}
        if isinstance(bounded.get("value"), (int, float)):
            value = float(bounded["value"])
            bound_operator = bounded.get("operator")

    canonical_key = biomarker.get("key")
    source_name = source.get("name") or "Unknown biomarker"
    return {
        "user_id": user_id,
        "report_id": report_id,
        "terra_session_id": session_id,
        "marker_slug": canonical_key,
        "marker": biomarker.get("display_name") or source_name,
        "raw_name": source_name,
        "loinc_code": biomarker.get("loinc_code"),
        "specimen": biomarker.get("specimen"),
        "panel_id": biomarker.get("panel_id"),
        "panel_key": biomarker.get("panel_key"),
        "value": value,
        "bound_operator": bound_operator,
        "measurement": measurement,
        "unit": measurement.get("units") or source.get("units") or "",
        "ucum_code": measurement.get("ucum_code"),
        "reference_low": applied_range.get("lower"),
        "reference_high": applied_range.get("upper"),
        "reference_ranges": ranges,
        "interpretation_flag": interpretation.get("flag"),
        "source_detail": source,
        "source": "terra_lab_report",
        "measured_at": measured_at,
    }


def format_observation_for_interpretation(observation: dict[str, Any]) -> str:
    """Keep numeric and non-numeric Terra results visible to the interpretation model."""
    measurement = observation.get("measurement") or {}
    measurement_type = measurement.get("type")
    value: object = observation.get("value")
    if measurement_type == "bounded" and measurement.get("bounded"):
        bounded = measurement["bounded"]
        symbol = "<" if bounded.get("operator") == "lt" else ">"
        value = f"{symbol}{bounded.get('value')}"
    elif measurement_type == "qualitative":
        value = (measurement.get("qualitative") or {}).get("text")
    elif measurement_type == "text":
        value = measurement.get("text")
    elif measurement_type == "absent":
        value = measurement.get("absent_reason") or "non renseigné"

    label = observation.get("marker_slug") or observation.get("raw_name") or observation["marker"]
    unit = observation.get("unit") or measurement.get("units") or ""
    reference = ""
    if observation.get("reference_low") is not None or observation.get("reference_high") is not None:
        reference = (
            f" [ref {observation.get('reference_low')}-{observation.get('reference_high')}]"
        )
    signal = observation.get("interpretation_flag")
    signal_text = f", signal={signal}" if signal else ""
    return f"{label} ({observation['marker']}): {value or 'non renseigné'} {unit}{reference}{signal_text}".strip()