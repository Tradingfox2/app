# Computed metrics (Wave B)

These values are derived when they are read. This wave does not add tables for them.

## Personal records

Personal records are not stored. Do not add `personal_records`.

They are computed from `workout_sets`:

- `GET /progression/{exercise_id}` in `backend/server.py` (`progression`, `_epley_1rm`) returns the best estimated 1RM per day and the current PR. The estimate is Epley: `weight * (1 + reps / 30)`; a single rep is the weight itself.
- Program generation uses the same Epley estimate over the last 14 days in `training_history` (`backend/routers/program.py`).

## Streaks

Streaks are not stored. There is no login-streak store.

- Training streak: `dashboard_snapshot` in `backend/server.py` counts consecutive calendar days, ending today or yesterday, that have a workout, and returns `training.streak_days`.
- Check-in streaks: `messages.checkin_day` is passed to `streaks` in `backend/challenges.py`. One rest day does not break a check-in streak; two in a row do.

## Club leaderboards

There is no dedicated leaderboard table.

- Public rankings come from `build_rankings` in `backend/community_rankings.py`, gated by `users.activity_ranking_opt_in` and channel `ranking_opt_in`. Consent is evaluated on every request.
- Challenge scoreboards are `GET /channels/{channel_id}/challenge` in `backend/routers/community.py`. Only challenge participants are scored, and only from finished workouts inside the window (`backend/challenges.py`).

## Workout templates

There is no `workout_templates` table unless a later product decision proves it is needed.

Reuse `programs` (`public.programs`) or duplicate a finished workout. Exercises queued before logging live on the workout as `planned_exercise_slugs` (`WorkoutIn` in `backend/server.py`).

## Readiness

IronFlow Readiness is not stored. `backend/readiness.py` is the only place that computes it. `GET /api/readiness/today` and the `readiness` object on `GET /home/today` return `{score, verdict, confidence, components, missing}`.

`score` is an integer from 0 to 100, or null when nothing could be scored. Null means unknown. A score of 0 means the present inputs scored at the floor. `verdict` is `push` at 67 and above, `steady` from 34 through 66, `rest` below 34, and null when `score` is null. `confidence` is the fraction of the 100 weight points whose inputs were present (0–1).

When an input is present its weight is HRV 35, resting heart rate 20, sleep 25, and acute:chronic load 20. Missing inputs are dropped and the remaining weights are renormalized. A missing or non-positive measurement is left out of `components` and named in `missing`. It is not scored as 0, and no wearable number is invented to fill it.

- HRV: `clamp(75 + 250 × (latest / 14-day mean − 1))`. The mean needs at least three other positive samples in the last 14 days. The latest reading is excluded from its own baseline. A reading older than 48 hours is not used.
- Resting heart rate: `clamp(75 − 5 × (latest − 14-day mean))`, in beats per minute, with the same baseline rules. Higher than baseline lowers the score.
- Sleep: `clamp(100 × min(hours, 8) / 8)`. The need is 8 hours, the midpoint of the adult 7–9 hour range. It is a constant, not a measured wearable value.
- Load: acute:chronic = `load_7d / (load_28d / 4)`, then `clamp(75 − 125 × (ratio − 1))`. A stored `training_load` series on `wearable_metrics` is the load. Until that series exists, each finished workout contributes `perceived_effort × duration_sec / 60` when both numbers are positive. No such load leaves the component out. `load_28d` of 0 cannot form a ratio, so the component is missing rather than 0.

## Out of scope

Presence, `last_seen`, and a PR cache are P2. They are not part of this change.
