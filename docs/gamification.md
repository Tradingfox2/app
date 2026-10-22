# IronFlow gamification & motivation plan (v1, 2026-10-22)

## 0. Audit — what already exists on main (822a7b8), and how this plan reuses it
| Existing | Where | Reuse |
|---|---|---|
| Rest-day-tolerant streaks (one rest day never breaks; two do) + Strava-style opt-in channel challenges (workouts/active_days/minutes/tonnage) | `backend/challenges.py`, `routers/community.py` `/channels/{id}/challenge*` | `ProgressStreak` calls `challenges.streaks()`; challenge metrics reuse the same metric names. Channel challenges stay as they are; the new engine adds solo/friends/coach/club challenges on top. |
| Gym check-in rewards (every N visits, codes, owner redeem) | `routers/gyms.py`, `db.rewards` | Gym rewards appear in the reward catalogue read-only (no new money path). A gym check-in is a verified action worth XP. |
| Referrals → Pro credit days (`users.pro_credit_until`) | `referrals.py` `_extend_credit` | Reward catalogue "Pro credit days" extend the same field. |
| Missed-session reminder (#56) | `frontend/src/missed-session*.ts` (local, weekly) | Untouched; server nudges never duplicate it (no "missed session" kind). |
| Apple Health / Health Connect steps (#55) | read on device (`phone-health.ts`); server steps live in `wearable_metrics` from aggregators/Samsung import | Steps XP only from `wearable_metrics` rows with a provider `device`/source; manual `POST /wearable-metrics` and `simulated` rows never count. |
| Wearables aggregators (#58) | `wearable_aggregators.py`, `routers/wearables.py` | Synced step days are awarded on the next `/progress` read (idempotent per day). |
| Community, feed, kudos | `routers/community.py`, `routers/social.py` | Social XP (post, kudos given) capped per day. Club cups rank communities. |
| Notifications + Expo push | `notifications.py` (`create`, prefs, `CONFIGURABLE`), `push.py` | New kinds `progress_nudge`, `league_result`, `badge_unlocked` are configurable, respect prefs, never carry health data. |
| i18n (en, fr, de, es, it) | `frontend/src/i18n.tsx` + `*-locales.ts` | New `progress-locales.ts`. |
| Animations | `react-native-reanimated` 4.5, `react-native-svg`, `expo-haptics`, `useReducedMotion()` in `src/affordance` | All celebrations use these; reduce-motion → static state, no burst. |

## 1. Principles
- Points (XP) reward **real, verified training**: logged and finished workouts, step days from a health source, gym check-ins. Never self-typed numbers.
- XP is **not money**: no cash-out, no transfer, no purchase of XP, no loot boxes, random drops or paid spins. Rewards are fixed-price and visible up front.
- Health data never leaves the progress system and is never used for ads. Push bodies never contain health values.
- Rest is part of training: streaks tolerate one rest day; freezes cover more. Copy is supportive, never shaming.

## 2. XP (all values in `backend/gamification_config.py` → overridable by env `GAMIFICATION_CONFIG` JSON)
| Action | XP | Cap / anti-cheat |
|---|---|---|
| Workout finished (`/workouts/{id}/finish`, ≥ 10 min or ≥ 3 sets) | 50 | 3 per day; one award per workout id |
| Per 10 min of a finished workout | +5 | max +40 per workout |
| Steps day ≥ 5 000 / ≥ 10 000 (health source only) | 10 / 25 | once per day (`steps:YYYY-MM-DD` key) |
| Gym check-in | 15 | 1 per day |
| Streak day kept | 5 × min(streak, 10) | once per day |
| Badge unlocked | badge.xp (25–500) | once per badge |
| Challenge completed | challenge.xp_reward (default 100) | once per challenge |
| Post published / kudos given | 3 / 1 | 15 XP social total per day |

Ledger: `xp_ledger` append-only, unique index on `(user_id, key)` → duplicates are impossible, replays are safe. Totals are a cached projection (`progress_profiles`) recomputable from the ledger.

## 3. Levels & stages
Level n needs `100·n^1.5` cumulative XP (L2 = 283, L10 ≈ 3 162, L30 ≈ 16 432). Stages (cosmetic name + ring colour): Rookie 1–4, Mover 5–9, Athlete 10–19, Pro 20–34, Elite 35–49, Legend 50+.

## 4. Streaks + freeze tokens
Streak = training days (workout finished or gym check-in, or ≥ 5 000 health steps), computed by existing `challenges.streaks()` (gap ≤ 2 days). Freeze tokens: earn 1 per 7-day streak milestone (max 3 held); a freeze auto-covers one additional missing day. Freezes are never sold.

## 5. Badges (milestones) — catalogue in config
first_workout · workouts_10/50/100/250 · streak_7/30/100 · steps_day_10k · steps_total_100k/1M · minutes_total_1000 · first_pr (new est. 1RM) · prs_10 · first_gym_checkin · gym_checkins_25 · first_challenge · challenges_5 · league_promoted · league_champion · cup_winner · level_10/25/50.

## 6. Challenges
Types: **solo** (weekly auto-generated: "3 workouts", "40 000 steps"), **friends** (creator invites, max 20), **club** (community-wide, by community owner/admin), **coach** (coach for their clients). Metrics: workouts, active_days, minutes, steps, xp. Window ≤ 92 days (same as channel challenges). Opt-in join; progress from ledger + workouts; completion → badge/XP + confetti.

## 7. Leagues & cups
- **Weekly leagues**: divisions Bronze → Silver → Gold → Platinum → Diamond. Groups of up to 30 by division, ranked by weekly XP. Top 5 promoted, bottom 5 relegated (none from Bronze), only members with ≥ 1 XP that week are placed. Closed Monday 00:00 UTC (lazily on first read of the new week, idempotent).
- **Cups**: monthly community-vs-community cup: score = average XP per active member (fair to small clubs, min 3 active). Winner gets a cup on the club page + `cup_winner` badge for active members.

## 8. Reward catalogue (spend XP? **No.** Rewards are unlocked by level/badges, not bought with points)
To stay clear of points-as-currency, rewards are **milestone unlocks**: profile frames (bronze/silver/gold/neon, per stage), accent colours, title flair, **Pro credit days** (3 days at levels 5,10,20 — capped 30 days/year, via `pro_credit_until`), streak freeze tokens, and partner **gym rewards** (existing every-N-visits). Nothing exchangeable for cash.

## 9. Follow-up nudges (server, via `notifications.create`, max 1 progress push per day, quiet 21:00–08:00 local)
- **streak_at_risk**: streak ≥ 3, last training day = 2 days ago (tomorrow it breaks), no freeze.
- **near_milestone**: ≤ 10% away from next badge/level.
- **comeback**: no training for 7 days (once per 14 days), warm copy.
- **league_result**: after weekly close (promoted / stayed / relegated + rank).
Run by `POST /api/progress/nudges/run` (cron secret `PROGRESS_CRON_SECRET`, e.g. Render Cron hourly) and opportunistically on progress reads.

## 10. Anti-cheat
Dedupe keys per source event; daily caps; steps only from provider sources (not manual / simulated); workouts must be finished with duration ≥ 10 min or ≥ 3 sets and not more than 3/day; future dates rejected; leagues count only ledger XP; admins can void ledger entries via a compensating negative entry (append-only).

## 11. Compliance
No cash value, no gambling mechanics, no purchasable odds, no health data in ads or in push text, GDPR: progress data deleted with the account; leaderboards show only display name + level, opt-out of leagues in settings.

## 12. Slices (one PR each)
1. Backend engine — `backend/gamification.py` (classes with static methods), `gamification_config.py`, `routers/progress.py`, tests.
2. Frontend Progress hub — `app/progress.tsx`, `src/components/progress/*`, celebrations, i18n ×5, entry from Home/Profile.
3. Hooks & nudges — award on finish/check-in/steps, nudges via notifications.

## 13. Decisions for Roland (all config, no code change)
XP values & caps · level curve · Pro-credit-day unlocks (3 days at L5/10/20, cap 30/yr) · league size/promotion counts · whether leagues are opt-in or opt-out · cup cadence (monthly) · nudge quiet hours.
