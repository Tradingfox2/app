from __future__ import annotations

import asyncio
import hashlib
import hmac

import ai
from ai import default_model
from locales import SUPPORTED_LOCALES, lab_disclaimer, lab_language_instruction, normalize_locale
from terra_labs import format_observation_for_interpretation, map_result, verify_webhook_signature


def test_labs_task_resolves_to_claude_sonnet_4():
    assert default_model("anthropic", "labs") == "claude-sonnet-4-6"


def test_supported_lab_languages_have_prompts_and_disclaimers():
    assert SUPPORTED_LOCALES == ("fr", "en", "de", "es", "it")
    for locale in SUPPORTED_LOCALES:
        assert normalize_locale(locale) == locale
        assert lab_disclaimer(locale)
        assert "JSON keys unchanged" in lab_language_instruction(locale)
    assert normalize_locale("zh") == "fr"
    assert normalize_locale("ar") == "fr"


def test_lab_interpretation_forces_anthropic_labs_route(monkeypatch):
    captured = {}

    async def fake_llm_json(system, prompt, **kwargs):
        captured.update(system=system, prompt=prompt, **kwargs)
        return kwargs["validator"]({"summary": ["Result summary"], "trends": [], "flags": []})

    monkeypatch.setattr(ai, "llm_json", fake_llm_json)

    result = asyncio.run(
        ai.llm_labs_json(
            "Lab system prompt",
            "MARQUEURS DU JOUR:\nglucose=91",
            validator=lambda value: value,
        )
    )

    assert result["summary"] == ["Result summary"]
    assert captured["provider"] == "anthropic"
    assert captured["task"] == "labs"


def test_verify_webhook_signature_accepts_valid_raw_payload():
    payload = b'{"type":"lab_report.completed"}'
    timestamp = 1_725_000_000
    secret = "test-secret"
    digest = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256
    ).hexdigest()

    assert verify_webhook_signature(
        payload,
        f"t={timestamp},v1={digest}",
        secret,
        now_timestamp=timestamp + 30,
    )
    assert not verify_webhook_signature(
        payload + b" ",
        f"t={timestamp},v1={digest}",
        secret,
        now_timestamp=timestamp + 30,
    )


def test_verify_webhook_signature_rejects_replay():
    payload = b"{}"
    timestamp = 1_725_000_000
    secret = "test-secret"
    digest = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256
    ).hexdigest()

    assert not verify_webhook_signature(
        payload,
        f"t={timestamp},v1={digest}",
        secret,
        now_timestamp=timestamp + 301,
    )


def test_map_result_preserves_bounded_measurement_and_provenance():
    mapped = map_result(
        {
            "source": {
                "name": "Prostate Specific Antigen",
                "value": "<0.04",
                "units": "ng/mL",
                "collection_date": "2026-03-15",
            },
            "biomarker": {
                "key": "prostate_specific_antigen_total",
                "display_name": "PSA",
                "loinc_code": "2857-1",
                "specimen": "blood",
            },
            "measurement": {
                "type": "bounded",
                "bounded": {"operator": "lt", "value": 0.04},
                "units": "ng/mL",
                "ucum_code": "ng/mL",
            },
            "interpretation": {"flag": None, "source": "none"},
            "reference_ranges": [{"upper": 4.0, "type": "normal"}],
        },
        report_id="report-1",
        session_id="297405620317847552",
        user_id="user-1",
    )

    assert mapped["value"] == 0.04
    assert mapped["bound_operator"] == "lt"
    assert mapped["loinc_code"] == "2857-1"
    assert mapped["measurement"]["type"] == "bounded"
    assert mapped["reference_ranges"] == [{"upper": 4.0, "type": "normal"}]
    assert mapped["measured_at"].isoformat().startswith("2026-03-15")


def test_map_result_keeps_qualitative_result_without_fake_numeric_value():
    mapped = map_result(
        {
            "source": {"name": "Hepatitis B Surface Antigen", "value": "Negative"},
            "biomarker": {"key": None, "display_name": "Hepatitis B Surface Antigen"},
            "measurement": {"type": "qualitative", "qualitative": {"text": "Negative"}},
            "interpretation": {"flag": "normal", "source": "report"},
            "reference_ranges": [],
        },
        report_id="report-1",
        session_id="session-1",
        user_id="user-1",
    )

    assert mapped["marker_slug"] is None
    assert mapped["value"] is None
    assert mapped["measurement"]["qualitative"]["text"] == "Negative"


def test_qualitative_result_is_included_in_claude_interpretation_input():
    text = format_observation_for_interpretation(
        {
            "marker_slug": "urine_protein",
            "marker": "Urine Protein",
            "raw_name": "Protein, urine",
            "value": None,
            "unit": "",
            "interpretation_flag": "normal",
            "measurement": {"type": "qualitative", "qualitative": {"text": "Negative"}},
        }
    )

    assert "Urine Protein" in text
    assert "Negative" in text
    assert "signal=normal" in text


def test_bounded_result_keeps_operator_in_claude_interpretation_input():
    text = format_observation_for_interpretation(
        {
            "marker_slug": "psa",
            "marker": "PSA",
            "value": 0.04,
            "unit": "ng/mL",
            "measurement": {"type": "bounded", "bounded": {"operator": "lt", "value": 0.04}},
        }
    )

    assert "<0.04 ng/mL" in text