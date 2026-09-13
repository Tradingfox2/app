"""Supported user-facing languages for generated health content."""

SUPPORTED_LOCALES = ("fr", "en", "de", "es", "it")
DEFAULT_LOCALE = "fr"

LANGUAGE_NAMES = {
    "fr": "French",
    "en": "English",
    "de": "German",
    "es": "Spanish",
    "it": "Italian",
}

COACH_FALLBACKS = {
    "fr": ("recovery", "La récupération est votre boussole. Poussez les jours verts, ralentissez les jours rouges."),
    "en": ("recovery", "Recovery is your compass. Push hard on green days, glide on red ones."),
    "de": ("recovery", "Erholung ist dein Kompass. Trainiere an grünen Tagen hart und an roten locker."),
    "es": ("recovery", "La recuperación es tu brújula. Entrena fuerte en días verdes y suave en los rojos."),
    "it": ("recovery", "Il recupero è la tua bussola. Spingi nei giorni verdi e rallenta in quelli rossi."),
}

CIRCUIT_FALLBACKS = {
    "fr": ("Circuit {muscle} {goal}", "Circuit progressif de niveau {level}, adapté à l'équipement disponible."),
    "en": ("{muscle} {goal} Circuit", "Progressive {goal} circuit for {level} level using available equipment."),
    "de": ("{muscle}: {goal}-Zirkel", "Progressiver {goal}-Zirkel auf Niveau {level} mit der verfügbaren Ausrüstung."),
    "es": ("Circuito de {goal}: {muscle}", "Circuito progresivo de {goal} para nivel {level} con el equipo disponible."),
    "it": ("Circuito {goal}: {muscle}", "Circuito progressivo di {goal} per livello {level} con l'attrezzatura disponibile."),
}

LAB_DISCLAIMERS = {
    "fr": "Interprétation éducative générée par IA — ce n'est PAS un avis médical. Ces informations doivent être validées par un professionnel de santé.",
    "en": "AI-generated educational interpretation — this is NOT medical advice. Review this information with a qualified healthcare professional.",
    "de": "KI-generierte Interpretation zu Bildungszwecken — dies ist KEINE medizinische Beratung. Lassen Sie diese Informationen von medizinischem Fachpersonal prüfen.",
    "es": "Interpretación educativa generada por IA — esto NO es asesoramiento médico. Revise esta información con un profesional sanitario cualificado.",
    "it": "Interpretazione educativa generata dall'IA — NON è un consulto medico. Verifica queste informazioni con un professionista sanitario qualificato.",
}


def normalize_locale(value: str | None) -> str:
    locale = (value or DEFAULT_LOCALE).strip().lower().split("-")[0]
    return locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE


def lab_disclaimer(locale: str | None) -> str:
    return LAB_DISCLAIMERS[normalize_locale(locale)]


def lab_language_instruction(locale: str | None) -> str:
    language = LANGUAGE_NAMES[normalize_locale(locale)]
    return f"Write every user-facing string value entirely in {language}. Keep JSON keys unchanged."


def content_language_instruction(locale: str | None) -> str:
    language = LANGUAGE_NAMES[normalize_locale(locale)]
    return f"Write every user-facing string value entirely in {language}. Keep JSON keys, enum values, IDs, and slugs unchanged."


def coach_fallback(locale: str | None) -> tuple[str, str]:
    return COACH_FALLBACKS[normalize_locale(locale)]


def circuit_fallback(locale: str | None, muscle: str, goal: str, level: str) -> tuple[str, str]:
    name, rationale = CIRCUIT_FALLBACKS[normalize_locale(locale)]
    values = {"muscle": muscle, "goal": goal, "level": level}
    return name.format(**values), rationale.format(**values)