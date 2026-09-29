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

## Out of scope

Presence, `last_seen`, and a PR cache are P2. They are not part of this change.
