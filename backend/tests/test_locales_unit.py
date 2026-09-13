from locales import (
    SUPPORTED_LOCALES,
    circuit_fallback,
    coach_fallback,
    content_language_instruction,
    normalize_locale,
)


def test_normalize_locale_accepts_region_and_falls_back() -> None:
    assert normalize_locale("de-DE") == "de"
    assert normalize_locale("ES_es") == "fr"
    assert normalize_locale("zh-CN") == "fr"
    assert normalize_locale(None) == "fr"


def test_generation_instruction_preserves_machine_fields() -> None:
    instruction = content_language_instruction("it")

    assert "Italian" in instruction
    assert "JSON keys" in instruction
    assert "enum values" in instruction
    assert "slugs unchanged" in instruction


def test_localized_fallbacks_cover_every_supported_locale() -> None:
    coach_tips = []
    circuits = []

    for locale in SUPPORTED_LOCALES:
        focus, tip = coach_fallback(locale)
        name, rationale = circuit_fallback(locale, "Chest", "strength", "beginner")
        assert focus == "recovery"
        assert tip
        assert name
        assert rationale
        coach_tips.append(tip)
        circuits.append((name, rationale))

    assert len(set(coach_tips)) == len(SUPPORTED_LOCALES)
    assert len(set(circuits)) == len(SUPPORTED_LOCALES)
