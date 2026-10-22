"""Gamification numbers, in one place.

Every value here is a product decision, not code: XP per action, caps, the level
curve, badge thresholds, league sizes and the Pro-credit unlocks. Override any of
them without a deploy of new code by setting `GAMIFICATION_CONFIG` to a JSON
object; keys are merged one level deep over the defaults below.

Points are never money: they cannot be bought, sold, transferred or cashed out,
and nothing here is random. That keeps the system clear of gambling and of
"points as currency" rules.
"""
from __future__ import annotations

import json
import logging
import os
from copy import deepcopy

logger = logging.getLogger(__name__)

DEFAULTS: dict = {
    "xp": {
        "workout": 50,              # a finished, verified workout
        "workout_per_10_min": 5,    # duration bonus
        "workout_minutes_bonus_cap": 40,
        "steps_5k": 10,             # a health-source step day >= 5 000
        "steps_10k": 25,            # ... and >= 10 000 (on top)
        "gym_checkin": 15,
        "streak_day_per_day": 5,    # 5 x min(streak, streak_day_cap)
        "streak_day_cap": 10,
        "pr": 20,                   # new estimated 1RM on an exercise
        "post": 3,
        "kudos": 1,
        "challenge_default": 100,
    },
    "caps": {
        "workouts_per_day": 3,
        "prs_per_workout": 3,
        "social_xp_per_day": 15,
        "gym_checkins_per_day": 1,
    },
    "verification": {
        "min_workout_minutes": 10,
        "min_workout_sets": 3,
        "steps_5k": 5000,
        "steps_10k": 10000,
        # Rows typed by hand or generated as samples never earn XP.
        "excluded_devices": ["manual", "IronFlow manual", "manual_entry"],
        "excluded_sources": ["client"],
        "backfill_days": 60,
    },
    "levels": {"base": 100, "exponent": 1.5, "max": 100},
    "stages": [
        {"id": "rookie", "from": 1}, {"id": "mover", "from": 5}, {"id": "athlete", "from": 10},
        {"id": "pro", "from": 20}, {"id": "elite", "from": 35}, {"id": "legend", "from": 50},
    ],
    "streak": {"freeze_every_days": 7, "max_freezes": 3},
    "weekly_goal": {"default_workouts": 3, "min": 1, "max": 7, "default_steps": 50000},
    "league": {
        "divisions": ["bronze", "silver", "gold", "platinum", "diamond"],
        "group_size": 30, "promote": 5, "relegate": 5,
    },
    "cup": {"min_active_members": 3, "max_ranked": 50},
    "pro_credit_unlocks": {"5": 3, "10": 3, "20": 3},  # level -> Pro credit days
    "pro_credit_days_per_year_cap": 30,
    "nudges": {"quiet_start_hour": 21, "quiet_end_hour": 8, "comeback_after_days": 7,
               "comeback_every_days": 14, "near_milestone_ratio": 0.9},
    "challenges": {"max_days": 92, "max_friends": 20},
}

# (id, metric, threshold, xp). Metrics are counters computed by Badges.counters().
BADGES: list[tuple[str, str, int, int]] = [
    ("first_workout", "workouts", 1, 25),
    ("workouts_10", "workouts", 10, 50),
    ("workouts_50", "workouts", 50, 150),
    ("workouts_100", "workouts", 100, 300),
    ("workouts_250", "workouts", 250, 500),
    ("streak_7", "longest_streak", 7, 50),
    ("streak_30", "longest_streak", 30, 200),
    ("streak_100", "longest_streak", 100, 500),
    ("steps_day_10k", "best_steps_day", 10000, 25),
    ("steps_total_100k", "steps_total", 100000, 50),
    ("steps_total_1m", "steps_total", 1000000, 300),
    ("minutes_1000", "minutes_total", 1000, 150),
    ("first_pr", "prs", 1, 25),
    ("prs_10", "prs", 10, 100),
    ("first_gym_checkin", "gym_checkins", 1, 25),
    ("gym_checkins_25", "gym_checkins", 25, 150),
    ("first_challenge", "challenges_completed", 1, 50),
    ("challenges_5", "challenges_completed", 5, 150),
    ("league_promoted", "league_promotions", 1, 50),
    ("league_champion", "league_wins", 1, 150),
    ("cup_winner", "cups_won", 1, 200),
    ("level_10", "level", 10, 0),
    ("level_25", "level", 25, 0),
    ("level_50", "level", 50, 0),
]

#: Cosmetic profile frames, unlocked by stage. Nothing here is sold.
FRAMES: list[tuple[str, str]] = [
    ("none", "rookie"), ("bronze", "mover"), ("silver", "athlete"),
    ("gold", "pro"), ("neon", "elite"), ("legend", "legend"),
]


def _merged() -> dict:
    config = deepcopy(DEFAULTS)
    raw = os.environ.get("GAMIFICATION_CONFIG", "").strip()
    if not raw:
        return config
    try:
        override = json.loads(raw)
    except ValueError:
        logger.warning("GAMIFICATION_CONFIG is not valid JSON; using defaults")
        return config
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(config.get(key), dict):
            config[key].update(value)
        else:
            config[key] = value
    return config


CONFIG = _merged()
