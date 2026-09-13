"""Did-you-know coaching tips — GET /api/tips/daily.

Two layers:
1. Personalised tips written once a day by the *fast* LLM (Haiku) from the
   athlete's last-7-days snapshot (sets, tonnage, muscles hit, streak, sleep,
   HRV...). Cached in `daily_tips` per user/day so the model is called at most
   once per athlete per day.
2. A curated, evidence-informed library (training, recovery, sleep, nutrition,
   hydration, mobility, mindset, health) used as the deterministic fallback when
   no LLM provider is configured/reachable. Selection is seeded by date+user so
   it rotates daily without repeating within a day.

GET /api/coach/tip is the same idea for the Home "COACH TIP" card: one Haiku
sentence per day, personalised, cached, with a static fallback.
"""
from __future__ import annotations

import hashlib
import logging
import random
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, ValidationError

from ai import LLMError, LLMNotConfigured, active_model_label, llm_json
from locales import coach_fallback, content_language_instruction, normalize_locale
from server import current_user, dashboard_snapshot, db, now

log = logging.getLogger("ironflow.tips")
router = APIRouter()

CATEGORIES = ("training", "recovery", "sleep", "nutrition", "hydration", "mobility", "mindset", "health")

# (category, title, body, source-flavoured hint)
TIPS: list[tuple[str, str, str]] = [
    # ---- training ---------------------------------------------------------- #
    ("training", "Progressive overload wins", "Add a rep, a kilo, or a set each week. Small, steady increases beat heroic jumps that stall you."),
    ("training", "10–20 sets per muscle, per week", "Most lifters grow best with 10–20 hard sets per muscle group each week, spread over 2+ sessions."),
    ("training", "Train each muscle twice a week", "Hitting a muscle two or three times a week grows it more than one huge session — same total volume, better distribution."),
    ("training", "Leave 1–3 reps in the tank", "Stopping 1–3 reps before failure (RPE 7–9) builds nearly as much muscle with far less fatigue to recover from."),
    ("training", "Compounds first", "Squats, hinges, presses and pulls first while you are fresh; isolation work comes after."),
    ("training", "Rest 2–3 minutes on heavy sets", "Longer rests on compound lifts let you lift more total load — and total load drives strength."),
    ("training", "Full range of motion grows more", "Deep stretch positions (bottom of a squat, long lat stretch) produce more hypertrophy than partial reps."),
    ("training", "Warm up specifically", "Ramp up with light sets of the lift you are about to do — 5 minutes on a bike alone does not prepare your nervous system."),
    ("training", "Antagonists keep joints healthy", "Balance push with pull (roughly 1:1 volume) to protect shoulders and posture over years of training."),
    ("training", "Deload every 4–8 weeks", "Cut volume by 30–50 % for a week when strength stalls or joints ache. You come back stronger."),
    ("training", "Control the eccentric", "Lowering the weight under control (2–3 s) produces more muscle damage — and adaptation — than dropping it."),
    ("training", "Grip strength predicts health", "Grip strength is one of the strongest simple predictors of long-term health. Farmer carries and dead hangs count."),
    ("training", "Unilateral work fixes imbalances", "Single-leg and single-arm variations expose and correct side-to-side gaps that bilateral lifts hide."),
    ("training", "Log every set", "Athletes who track their sessions progress faster — you cannot overload what you do not measure."),
    # ---- recovery ---------------------------------------------------------- #
    ("recovery", "Muscles grow between sessions", "Training is the stimulus; sleep and food are where the adaptation actually happens."),
    ("recovery", "48 hours before repeating a muscle", "Most muscles need about 48 h to recover from a hard session — that is why upper/lower or push/pull/legs splits work."),
    ("recovery", "HRV is your dashboard", "A morning HRV well below your 7-day baseline usually means fatigue: keep the session, lower the load."),
    ("recovery", "Walking speeds recovery", "A 20–30 minute easy walk on rest days increases blood flow and reduces soreness without adding fatigue."),
    ("recovery", "Soreness is not the goal", "DOMS is a sign of novelty, not of a good workout. Consistent training with little soreness is the real signal."),
    ("recovery", "Cold water: timing matters", "Ice baths right after lifting can blunt muscle growth. Save them for competition weeks or use heat instead."),
    ("recovery", "Resting heart rate trend", "A resting HR 5+ bpm above your norm for several days often precedes illness or overtraining."),
    ("recovery", "Two hard sessions a day? Eat between them", "Carbs and protein within an hour of the first session restore glycogen for the second."),
    # ---- sleep ------------------------------------------------------------- #
    ("sleep", "7–9 hours, non-negotiable", "Sleeping under 6 hours can cut muscle protein synthesis by ~18 % and raise injury risk in athletes by 1.7×."),
    ("sleep", "Consistent bedtime beats long lie-ins", "Going to bed and waking at the same time stabilises circadian rhythm — irregular sleep hurts performance even at equal duration."),
    ("sleep", "Dark, cool, quiet", "Around 18–19 °C, blackout curtains and no screens for 30 minutes before bed measurably improve deep sleep."),
    ("sleep", "Caffeine has a 5–6 h half-life", "A 16:00 coffee still has half its caffeine in your blood at 22:00. Cut off by early afternoon."),
    ("sleep", "Naps count", "A 20–30 minute nap restores alertness and reaction time without the grogginess of a longer one."),
    ("sleep", "Alcohol wrecks REM", "Even two drinks reduce REM sleep and overnight HRV — you will see it in tomorrow's recovery score."),
    # ---- nutrition --------------------------------------------------------- #
    ("nutrition", "1.6–2.2 g protein per kg", "That range maximises muscle gain for most athletes. Spread it across 3–5 meals of 25–40 g."),
    ("nutrition", "Carbs fuel intensity", "Glycogen is the main fuel for hard sets. Under-eating carbs is the most common reason lifts feel heavy."),
    ("nutrition", "Creatine monohydrate works", "3–5 g daily is the most researched supplement in sport: more strength, more reps, faster recovery. No loading needed."),
    ("nutrition", "Protein before bed", "30–40 g of slow protein (casein, Greek yogurt) before sleep supports overnight muscle repair."),
    ("nutrition", "Fibre is a performance nutrient", "25–35 g of fibre a day supports gut health, stable energy and better nutrient absorption."),
    ("nutrition", "Anabolic window is wide", "You do not need a shake within 30 minutes — total daily protein matters far more than timing."),
    ("nutrition", "Vitamin D for muscle", "Low vitamin D is common and linked to weaker muscle function. A blood test tells you whether you need to supplement."),
    ("nutrition", "Iron and fatigue", "Unexplained fatigue in athletes — especially women and endurance athletes — is often low ferritin. Check it in your labs."),
    ("nutrition", "Omega-3 and soreness", "2–3 g of EPA/DHA daily may reduce muscle soreness and support joint health."),
    # ---- hydration --------------------------------------------------------- #
    ("hydration", "2 % dehydration = weaker", "Losing just 2 % of body weight in fluid measurably reduces strength, power and focus."),
    ("hydration", "Salt your sweat back", "Long or hot sessions lose 500–1500 mg sodium per litre of sweat. Water alone is not enough."),
    ("hydration", "Check the colour", "Pale straw urine means well hydrated; dark yellow means drink up before training."),
    ("hydration", "Drink before you're thirsty", "Thirst lags behind fluid loss. Sip 400–600 ml in the 2 hours before a session."),
    # ---- mobility ---------------------------------------------------------- #
    ("mobility", "Stretch after, not before", "Long static stretching before lifting can reduce power. Do dynamic warm-ups first, static stretching after."),
    ("mobility", "Hips and ankles unlock squats", "Most squat depth problems come from ankle or hip mobility, not from the knees."),
    ("mobility", "Thoracic spine for pressing", "A stiff upper back forces the shoulders to compensate. Foam-roll and extend the T-spine before overhead work."),
    ("mobility", "Loaded stretching builds tissue", "Pausing in the stretched position of a lift (e.g. deep split squat) improves flexibility and grows muscle."),
    # ---- mindset ----------------------------------------------------------- #
    ("mindset", "Consistency compounds", "Three average sessions a week for a year beats a perfect month followed by burnout."),
    ("mindset", "Focus on the process", "Goals like ‘log every set’ or ‘train 3× a week’ are fully in your control — outcomes follow."),
    ("mindset", "Music raises output", "Self-selected, fast-tempo music can increase reps to failure and lower perceived effort."),
    ("mindset", "Visualise the lift", "Mentally rehearsing a heavy rep primes the nervous system and improves technique under load."),
    ("mindset", "Missed a day? Never miss two", "One skipped session changes nothing. The habit breaks when one skip becomes two."),
    ("mindset", "Train with others", "People who train with a partner or community stick with it far longer. Share a session in Community."),
    # ---- health ------------------------------------------------------------ #
    ("health", "Strength training lowers all-cause mortality", "Just 30–60 minutes of resistance training per week is associated with 10–20 % lower risk of death from any cause."),
    ("health", "Muscle is metabolic armour", "More muscle mass improves insulin sensitivity and blood glucose control — lifting is preventive medicine."),
    ("health", "Zone 2 for the engine", "150 minutes a week of easy, conversational cardio builds mitochondria and speeds recovery between sets."),
    ("health", "Blood work tells the truth", "Ferritin, vitamin D, testosterone, thyroid and HbA1c explain a lot of plateaus. Upload your labs and track trends."),
    ("health", "Pain vs. discomfort", "Burning muscles is fine; sharp, joint or nerve pain is a stop signal. Swap the exercise, do not push through."),
    ("health", "Sunlight in the morning", "10 minutes of morning daylight anchors your circadian rhythm — better sleep tonight, better recovery tomorrow."),
    ("health", "Breathe through the nose", "Nasal breathing during warm-ups and easy cardio improves CO₂ tolerance and calms the nervous system."),
    ("health", "Posture is a habit, not a position", "Long sitting shortens hip flexors and weakens glutes. Stand up and move every 45 minutes on desk days."),
]

LOCALIZED_TIPS: dict[str, list[tuple[str, str, str]]] = {
    "fr": [
        ("training", "La surcharge progressive gagne", "Ajoutez une répétition, un kilo ou une série chaque semaine. Les petites progressions régulières durent."),
        ("recovery", "Les muscles grandissent au repos", "L'entraînement crée le stimulus ; le sommeil et l'alimentation permettent l'adaptation."),
        ("sleep", "Visez 7 à 9 heures", "Un sommeil régulier améliore la récupération, la technique et la capacité à produire de la force."),
        ("nutrition", "Répartissez vos protéines", "Répartissez vos apports sur trois à cinq repas pour soutenir la réparation musculaire toute la journée."),
        ("hydration", "Hydratez-vous avant la soif", "Buvez régulièrement avant et pendant la séance, surtout lorsqu'elle est longue ou qu'il fait chaud."),
        ("mobility", "Échauffez le mouvement", "Préparez-vous avec des séries légères du mouvement prévu plutôt qu'avec des étirements statiques prolongés."),
        ("mindset", "La régularité s'accumule", "Trois séances correctes chaque semaine valent mieux qu'un mois parfait suivi d'un arrêt."),
        ("health", "Écoutez les signaux de douleur", "Une brûlure musculaire est normale ; une douleur vive, articulaire ou nerveuse impose d'arrêter."),
        ("training", "Gardez des répétitions en réserve", "Arrêter une à trois répétitions avant l'échec stimule les muscles avec moins de fatigue."),
        ("recovery", "Marchez les jours de repos", "Une marche facile favorise la circulation et réduit les courbatures sans ajouter beaucoup de fatigue."),
    ],
    "de": [
        ("training", "Progressive Steigerung gewinnt", "Füge jede Woche eine Wiederholung, ein Kilo oder einen Satz hinzu. Kleine Schritte wirken langfristig."),
        ("recovery", "Muskeln wachsen in der Pause", "Training setzt den Reiz; Schlaf und Ernährung ermöglichen die Anpassung."),
        ("sleep", "Plane 7 bis 9 Stunden", "Regelmäßiger Schlaf verbessert Erholung, Technik und Kraftentwicklung."),
        ("nutrition", "Protein über den Tag verteilen", "Verteile deine Proteinzufuhr auf drei bis fünf Mahlzeiten, um die Muskelreparatur zu unterstützen."),
        ("hydration", "Trinke vor dem Durst", "Trinke vor und während des Trainings regelmäßig, besonders bei langen oder heißen Einheiten."),
        ("mobility", "Wärme die Bewegung auf", "Bereite dich mit leichten Sätzen der geplanten Übung statt mit langem statischem Dehnen vor."),
        ("mindset", "Beständigkeit summiert sich", "Drei solide Einheiten pro Woche schlagen einen perfekten Monat mit anschließendem Abbruch."),
        ("health", "Schmerzsignale ernst nehmen", "Muskelbrennen ist normal; stechender Gelenk- oder Nervenschmerz bedeutet Stopp."),
        ("training", "Wiederholungen im Tank lassen", "Ein bis drei Wiederholungen vor dem Versagen aufzuhören setzt Reize mit weniger Ermüdung."),
        ("recovery", "Gehe an Ruhetagen spazieren", "Ein lockerer Spaziergang fördert die Durchblutung und lindert Muskelkater ohne große Zusatzbelastung."),
    ],
    "es": [
        ("training", "Gana la sobrecarga progresiva", "Añade una repetición, un kilo o una serie cada semana. Los pequeños avances constantes perduran."),
        ("recovery", "El músculo crece al descansar", "El entrenamiento aporta el estímulo; el sueño y la comida permiten la adaptación."),
        ("sleep", "Busca entre 7 y 9 horas", "Un horario de sueño regular mejora la recuperación, la técnica y la producción de fuerza."),
        ("nutrition", "Reparte la proteína", "Distribuye la proteína en tres a cinco comidas para favorecer la reparación muscular durante el día."),
        ("hydration", "Bebe antes de tener sed", "Bebe con regularidad antes y durante la sesión, especialmente si es larga o hace calor."),
        ("mobility", "Calienta el movimiento", "Prepárate con series ligeras del ejercicio previsto en vez de hacer estiramientos estáticos largos."),
        ("mindset", "La constancia se acumula", "Tres sesiones correctas por semana superan a un mes perfecto seguido de abandono."),
        ("health", "Respeta las señales de dolor", "El ardor muscular es normal; el dolor agudo, articular o nervioso indica que debes parar."),
        ("training", "Deja repeticiones en reserva", "Parar entre una y tres repeticiones antes del fallo estimula el músculo con menos fatiga."),
        ("recovery", "Camina en los días de descanso", "Un paseo suave mejora el flujo sanguíneo y reduce las agujetas sin añadir mucha fatiga."),
    ],
    "it": [
        ("training", "Vince il sovraccarico progressivo", "Aggiungi una ripetizione, un chilo o una serie ogni settimana. I piccoli progressi durano."),
        ("recovery", "I muscoli crescono nel recupero", "L'allenamento crea lo stimolo; sonno e alimentazione permettono l'adattamento."),
        ("sleep", "Punta a 7-9 ore", "Un sonno regolare migliora recupero, tecnica e capacità di produrre forza."),
        ("nutrition", "Distribuisci le proteine", "Suddividi le proteine in tre-cinque pasti per sostenere la riparazione muscolare durante la giornata."),
        ("hydration", "Bevi prima di avere sete", "Bevi regolarmente prima e durante la sessione, soprattutto se è lunga o fa caldo."),
        ("mobility", "Riscalda il movimento", "Preparati con serie leggere dell'esercizio previsto invece di lunghi allungamenti statici."),
        ("mindset", "La costanza si accumula", "Tre buone sessioni a settimana battono un mese perfetto seguito dall'abbandono."),
        ("health", "Rispetta i segnali di dolore", "Il bruciore muscolare è normale; un dolore acuto, articolare o nervoso richiede di fermarsi."),
        ("training", "Lascia ripetizioni in riserva", "Fermarsi da una a tre ripetizioni prima del cedimento stimola i muscoli con meno fatica."),
        ("recovery", "Cammina nei giorni di riposo", "Una camminata leggera favorisce la circolazione e riduce l'indolenzimento senza molta fatica."),
    ],
}


def tip_library(locale: str) -> list[tuple[str, str, str]]:
    return LOCALIZED_TIPS.get(normalize_locale(locale), TIPS)


def daily_tips(
    user_id: str, count: int, day: datetime | None = None, locale: str = "en"
) -> list[dict]:
    """Stable, per-user, per-day selection of `count` tips across categories."""
    day = day or datetime.now(timezone.utc)
    seed_src = f"{user_id}:{day.strftime('%Y-%m-%d')}".encode()
    seed = int.from_bytes(hashlib.sha256(seed_src).digest()[:8], "big")
    rng = random.Random(seed)
    library = tip_library(locale)
    pool = list(range(len(library)))
    rng.shuffle(pool)
    # Prefer category variety: take at most one per category first, then fill.
    chosen: list[int] = []
    seen: set[str] = set()
    for idx in pool:
        cat = library[idx][0]
        if cat not in seen:
            chosen.append(idx)
            seen.add(cat)
        if len(chosen) >= count:
            break
    for idx in pool:
        if len(chosen) >= count:
            break
        if idx not in chosen:
            chosen.append(idx)
    return [
        {"id": f"tip-{i}", "category": library[i][0], "title": library[i][1], "body": library[i][2]}
        for i in chosen
    ]



# --------------------------------------------------------------------------- #
# LLM layer (fast model = Haiku)                                              #
# --------------------------------------------------------------------------- #
class _Tip(BaseModel):
    category: str
    title: str = Field(min_length=3, max_length=60)
    body: str = Field(min_length=20, max_length=260)


class _TipList(BaseModel):
    tips: list[_Tip] = Field(min_length=5, max_length=10)


TIPS_SYSTEM = (
    "You are IronFlow's strength & health coach. Write short 'did you know' tips for an athlete, "
    "grounded in exercise science (no medical diagnoses, no supplements dosing beyond mainstream "
    "guidance, no exclamation marks). Use the athlete snapshot to personalise at least half of the "
    "tips (e.g. muscles not trained this week, low sleep, long streak, no sessions yet). "
    f"Allowed categories: {', '.join(CATEGORIES)}. Vary categories. "
    "Return ONLY JSON: {\"tips\":[{\"category\":\"...\",\"title\":\"<= 8 words\",\"body\":\"1-2 sentences, <= 240 chars\"}]}"
)

COACH_TIP_SYSTEM = (
    "You are IronFlow's AI coach. Given the athlete's snapshot, write ONE motivating, concrete "
    "coaching sentence for today (max 160 characters, no emoji, no exclamation marks, second person). "
    "Prefer the most actionable signal: recovery/HRV/sleep if available, otherwise training volume, "
    "missed muscle groups or streak. Return ONLY JSON: {\"tip\":\"...\",\"focus\":\"recovery|training|sleep|nutrition|mindset\"}"
)


def _snapshot_text(snap: dict[str, Any]) -> str:
    tr = snap.get("training") or {}

    def val(key: str) -> Any:
        m = snap.get(key)
        return m.get("value") if isinstance(m, dict) else None

    lines = [
        f"workouts_last_7_days: {snap.get('workouts_this_week', 0)}",
        f"hard_sets_last_7_days: {tr.get('sets_week', 0)}",
        f"tonnage_kg_last_7_days: {tr.get('tonnage_week_kg', 0)}",
        f"minutes_last_7_days: {tr.get('minutes_week', 0)}",
        f"muscles_trained: {', '.join(tr.get('muscles_week') or []) or 'none'}",
        f"streak_days: {tr.get('streak_days', 0)}",
        f"active_workout_in_progress: {bool(snap.get('active_workout'))}",
        f"wearable_connected: {snap.get('wearable_connected')}",
    ]
    for k in ("recovery", "hrv", "sleep", "resting_hr", "strain"):
        v = val(k)
        if v is not None:
            lines.append(f"{k}: {v}")
    return "\n".join(lines)


def _validate_tips(data: Any) -> list[dict]:
    parsed = _TipList.model_validate(data)
    out = []
    for i, t in enumerate(parsed.tips):
        cat = t.category.strip().lower()
        if cat not in CATEGORIES:
            cat = "training"
        out.append({"id": f"ai-{i}", "category": cat, "title": t.title.strip(), "body": t.body.strip()})
    return out


async def _cached(collection: str, user_id: str, date: str, locale: str) -> dict | None:
    return await db[collection].find_one(
        {"user_id": user_id, "date": date, "locale": locale}, {"_id": 0}
    )


async def _store(collection: str, user_id: str, date: str, locale: str, payload: dict) -> None:
    await db[collection].update_one(
        {"user_id": user_id, "date": date, "locale": locale},
        {"$set": {**payload, "user_id": user_id, "date": date, "locale": locale, "created_at": now()}},
        upsert=True,
    )


def _stale(doc: dict | None, minutes: int = 30) -> bool:
    """Library fallbacks are retried after a while so the AI kicks in once configured."""
    if not doc or doc.get("source") != "library":
        return False
    created = doc.get("created_at")
    return not created or (now() - created).total_seconds() > minutes * 60


@router.get("/tips/daily")
async def tips_daily(
    count: int = Query(default=7, ge=5, le=10),
    user: dict = Depends(current_user),
):
    today = datetime.now(timezone.utc)
    date = today.strftime("%Y-%m-%d")
    uid = user["id"]
    locale = normalize_locale(user.get("preferred_locale"))

    cached = await _cached("daily_tips", uid, date, locale)
    if cached and not _stale(cached) and len(cached.get("tips") or []) >= count:
        return {**{k: v for k, v in cached.items() if k not in ("user_id",)}, "count": count,
                "tips": cached["tips"][:count], "library_size": len(tip_library(locale))}

    tips: list[dict]
    source = "library"
    try:
        snap = await dashboard_snapshot(uid)
        tips = await llm_json(
            f"{TIPS_SYSTEM}\n{content_language_instruction(locale)}",
            f"Write exactly {count} tips.\n\nATHLETE SNAPSHOT (last 7 days):\n{_snapshot_text(snap)}",
            validator=_validate_tips,
            task="fast",
        )
        source = active_model_label(task="fast")
    except (LLMNotConfigured, LLMError, ValidationError, ValueError) as e:  # graceful fallback
        log.warning("daily tips: LLM unavailable (%s) -> library", e)
        tips = daily_tips(uid, count, today, locale)

    payload = {"date": date, "locale": locale, "source": source, "tips": tips}
    await _store("daily_tips", uid, date, locale, payload)
    return {**payload, "count": count, "library_size": len(tip_library(locale))}


FALLBACK_COACH_TIPS = [
    ("recovery", "Recovery is your compass. Push hard on green days, glide on red ones."),
    ("training", "Add one rep or one kilo to your main lift today. Small overloads compound."),
    ("sleep", "Protect tonight's sleep: same bedtime, cool room, screens off 30 minutes before."),
    ("mindset", "Consistency beats intensity. Show up, log every set, leave two reps in the tank."),
    ("nutrition", "Hit 1.6 to 2.2 g of protein per kg today, spread over three or four meals."),
]


@router.get("/coach/tip")
async def coach_tip(user: dict = Depends(current_user)):
    """One personalised coaching sentence per day (fast model), cached per user/day."""
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    uid = user["id"]
    locale = normalize_locale(user.get("preferred_locale"))
    cached = await _cached("coach_tips", uid, date, locale)
    if cached and not _stale(cached):
        return {k: v for k, v in cached.items() if k != "user_id"}

    try:
        snap = await dashboard_snapshot(uid)

        def _v(d: Any) -> dict:
            tip = str(d.get("tip", "")).strip()
            if not (20 <= len(tip) <= 220):
                raise ValueError("tip length out of range")
            focus = str(d.get("focus", "training")).strip().lower()
            return {"tip": tip, "focus": focus if focus in CATEGORIES else "training"}

        res = await llm_json(
            f"{COACH_TIP_SYSTEM}\n{content_language_instruction(locale)}",
            f"ATHLETE SNAPSHOT:\n{_snapshot_text(snap)}", validator=_v, task="fast"
        )
        payload = {"date": date, "locale": locale, "source": active_model_label(task="fast"), **res}
    except (LLMNotConfigured, LLMError, ValueError) as e:
        log.warning("coach tip: LLM unavailable (%s) -> fallback", e)
        focus, tip = coach_fallback(locale)
        payload = {"date": date, "locale": locale, "source": "library", "tip": tip, "focus": focus}

    await _store("coach_tips", uid, date, locale, payload)
    return payload
