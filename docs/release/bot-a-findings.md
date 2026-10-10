# Bot A — athlete UX findings

Audit of the athlete app at `main` **`9604bac`** (`Upgrade Expo SDK 54 to 57 for Expo Go`), which contains **`089ec98`** (`Athlete app: IronFlow Motion + Night Studio redesign`). `089ec98` is an ancestor of `HEAD`. No app code was changed. Staff console was not audited and was not modified.

This pass judges the current source and a live web render. Older write-ups (`docs/athlete-ux-audit-bot-a.md`, `docs/athlete-review-bot-d.md`, `docs/athlete-redesign-report.md`) were read so known claims could be rechecked. A sentence in those files is not treated as a current defect.

## How this was judged

- Source read for auth, Home, the logger, the workout list and library, plans, metrics, labs, sources, check-in, community, settings, trends, morning check-in, and the offline set queue.
- Playwright (Chromium) against Expo web on port 8082. `EXPO_PUBLIC_SENTRY_DISABLED=1`. No backend and no MongoDB in this environment, so every `/api` call was mocked. Athlete: Ada Lift.
- Viewports used for the shots below: **390×844** and **1440×900**.
- Primary journey executed: sign-in form → today’s plan → start day → record a set → sync failure → retry → finish → Done returns to Home.
- Failure paths executed: bad password, non-JSON login response, Home 500 then retry, open-session list 500 during Start day, delayed previous-set prefill, labs 500, check-in payload missing the reward count, program JSON the client schema rejects.
- Native iOS and Android were not launched. Camera check-in, GPS record, and a process kill were not exercised.

Shots are JPEGs in `docs/release/bot-a/`.

## Verdict

The honesty work from Night Studio still holds on the screens that were rebuilt for it. Unknown readiness and missing wearables render as an em dash. A simulated **0** stays **0** and is labeled **Sample data**. A simulated **80** is **Sample data**, not Measured. Finish stays closed while a set is still queued, and a retry control is on the screen. Resume is the only Home primary while a workout is open. Trends still say a gap is not a zero.

The release blockers are on the logger and on session identity. After a set actually syncs, the logger still says it is saving and that finish is closed. Last-session numbers can replace what the athlete just typed. The logger opens with **8 / 60 / 7** already filled in. Start day treats a failed session list as “nothing is open” and creates another workout. A finished session with no duration renders as **0 min**.

No P0. Nothing in this pass deleted a logged set or signed the athlete into the wrong account. Several P1s will record the wrong session or the wrong numbers if they ship.

## Five problems to fix before release

1. **A-01.** After a successful retry, the set row still says **Saving** and the banner still says finish is closed.
2. **A-02.** A late “last time” response overwrites reps, weight, and RPE the athlete already typed.
3. **A-03.** With no history, the logger offers **8 reps, 60 kg, RPE 7** as real field values. One tap logs them.
4. **A-04.** If the open-session list fails, **START DAY** still creates a new workout and skips the merge sheet.
5. **A-05 and A-06.** A missing duration is shown as **0 min**. A missing check-in reward count is shown as **NaN** and **0 visits until reward**.

## What still holds

Checked on this commit, in source and in the render:

| Claim | Result on `9604bac` |
|---|---|
| Unknown metric is not drawn as 0 | Held. Home with null strain, recovery, sleep, HRV, and resting HR shows **—** and **Not connected**. Readiness shows **—** and “Unknown. Not enough measured inputs…”. `docs/release/bot-a/home-unknown-390.jpg` |
| A real or simulated zero stays zero | Held. Simulated strain **0** and sleep **0** show **0** and **Sample data**. `home-sample-390.jpg` |
| Sample data is not labeled live | Held on Home meters and on Sources. Garmin simulated reads **SAMPLE DATA** and “Sample data. This is not a live reading.” Whoop cloud reads **LIVE**. `sources-390.jpg` |
| No green/red recovery grade in the coach fallback | Held. A failed coach tip shows “Ask about today's session. Training guidance, not a diagnosis.” |
| Readiness is training guidance | Held on the planned Home. The note includes “Not a medical assessment.” `home-plan-390.jpg` |
| One Home primary while a workout is open | Held. **RESUME SESSION** only. Start day and Start empty are absent. Wide Home is a 1120px board, stage 660×420. `home-resume-1440.jpg` |
| Finish waits for the queue | Held. With one pending set, finish shows “Could not sync sets. Finish stays closed until they land.” and the share sheet stays shut. `logger-sync-fail-390.jpg` |
| Retry exists | Held. **Retry sync** is on the banner and on the row while the post is failing. |
| Labs failure is an error | Held. `labs/reports` 500 shows “labs down” and Retry. The upload-empty state is absent. `labs-error-390.jpg` |
| Trends do not drop a gap to zero | Held. Chart name: `Readiness: 60, 80. A gap is a missing day, not a zero.` Back from a cold `/analysis` reaches Home. `trends-390.jpg` |
| Home load failure can be retried | Held. “home down” plus Retry restores the screen. `home-error-390.jpg` |
| Plan week label matches the chip | Held for a readable plan. Week 4 reads **ADJUST WEEK 4**. `program-week4-390.jpg` |
| Sign out is one control, under the account sections | Held. One button named “Sign out”. Training plan, Trends, Labs, Sources, and Morning check-in are in Settings. |
| Expo SDK 57 did not restyle the athlete UI | The diff `089ec98..9604bac` is dependencies, `app.json` plugins, a tab-bar type import, and a community `StyleSheet.absoluteFill` rename. |

## Verified defects

### A-01 — Successful sync still says the set is saving and finish is closed

| | |
|---|---|
| ID | A-01 |
| Severity | P1 |
| Kind | Verified defect |
| Screen | Live logger |
| File | `frontend/app/workout/[id].tsx` |

**Repro**

1. Open `/workout/w-1` with a planned bench press.
2. Enter 5 reps and 80 kg. Tap add. Make `POST /workouts/w-1/sets` return 500.
3. Confirm the banner and that Finish does not open the share sheet.
4. Let the next `POST` succeed. Tap **Retry sync**. Stay on the logger.

**Evidence**

After the successful post the queue is empty (banner count 0) and the server accepted `{ reps: 5, weight_kg: 80, set_index: 1 }`. The row still reads **Saving**. The alert still reads “Could not sync sets. Finish stays closed until they land.” Shot: `docs/release/bot-a/logger-after-retry-390.jpg`.

`finish` writes that alert (`setFinishError` / `setLoggerError` around the pending check). **Retry sync** only calls `flushQueue()`. Nothing clears those strings. `isOptimisticSet` stays true while the row id starts with `local-`. A successful `addSet` response is never written back onto the row, so **Saving** remains until a later focus reload merges server sets.

A second Finish tap does open the share sheet (`logger-finished-390.jpg`). The first message is stale, and the data is on the server.

**Expected**

When the queue for this workout drops to zero, the row loses **Saving** and the finish alert disappears. Finish then opens the summary.

**Impact**

The athlete is told the set did not land and that they cannot finish, after it has landed. They may log the set again, or leave the session thinking it is stuck.

**Minimal fix**

On a flush that leaves `pendingFor(id) === 0`, clear `finishError` and `loggerError`, and replace `local-*` rows with the server rows (or drop the optimistic flag). Keep the alert only while `pendingFor` is still positive.

**Regression test**

Playwright: fail the first set POST, succeed the retry, then assert `offline-banner` and the finish alert are gone, the row does not say Saving, and the set is still 5 × 80. Then Finish shows `share-panel`.

### A-02 — Last-session prefill overwrites numbers the athlete already typed

| | |
|---|---|
| ID | A-02 |
| Severity | P1 |
| Kind | Verified defect |
| Screen | Live logger |
| File | `frontend/app/workout/[id].tsx` (`previousSets` effect, about lines 329–354) |

**Repro**

1. Open a logger whose `GET /exercises/{id}/previous-sets` is slow.
2. Before it returns, replace the fields with 12 reps and 100 kg.
3. Let the response arrive with set 1 = 3 reps, 40 kg, RPE 6.

**Evidence**

Rendered values after the response: reps **3**, weight **40**, RPE **6**. The typed 12 and 100 are gone. “Last time” is also shown. The effect always calls `setReps`, `setWeight`, and `setRpe` when the payload has numbers. It does not look at whether the athlete has edited the fields. It also reruns when `nextSetIndex` changes, so the same overwrite can happen between sets.

**Expected**

A response may fill empty or untouched fields. It leaves a value the athlete has changed. The “Last time” line can still show 3 × 40.

**Impact**

The set that gets logged is the previous session, not the set the athlete typed. Volume, PRs, and the plan’s next load are then wrong. This is invented training data.

**Minimal fix**

Remember a dirty flag per field (set it in the field `onChange`, clear it only when applying prefill to a field that is still untouched). Apply server hints only to fields that are still dirty === false.

**Regression test**

Delay `previous-sets` by ~1s. Fill 12 and 100. Release the response. Assert the inputs stay 12 and 100 and that “Last time” still mentions 40 kg. A second case with no typing asserts the fields become 3 and 40.

### A-03 — The logger opens with invented set values

| | |
|---|---|
| ID | A-03 |
| Severity | P1 |
| Kind | Verified defect |
| Screen | Live logger |
| File | `frontend/app/workout/[id].tsx` (initial state `reps` `"8"`, `weight` `"60"`, `rpe` `"7"`) |

**Repro**

1. Start today’s plan (or open `/workout/w-new`) when `previous-sets` returns no sessions.
2. Read the entry bar before typing.
3. Tap add without editing.

**Evidence**

On open, the fields are **8**, **60**, and **7**. Shot: `docs/release/bot-a/logger-open-390.jpg`. There is no “Last time” line and no hint that the numbers are a suggestion. They are the input values. Add will post them. This pass avoided that post by typing 5 and 80 first; the defaults were on screen before that.

**Expected**

With no history, reps, weight, and RPE start empty. Add explains that reps and weight are required (that guard already exists for a cleared field). Suggestions appear only after a real previous set, and they are labeled as last time.

**Impact**

One tap writes an 8×60 set the athlete did not perform. Tonnage and any later PR are then fiction.

**Minimal fix**

Initial state `""` for all three fields. Keep the existing `add-set-error` when reps or weight do not parse.

**Regression test**

Open `/workout/w-1` with `previous-sets` `{ sessions: [] }`. Assert the three inputs are empty. Tap add. Assert `add-set-error` and that no set row exists.

### A-04 — Start day creates a second workout when the session list fails

| | |
|---|---|
| ID | A-04 |
| Severity | P1 |
| Kind | Verified defect |
| Screen | Home, today’s session |
| File | `frontend/app/(tabs)/home.tsx` `startDay` (the `api.workouts()` catch sets `open` to undefined, then calls `startProgramDay`) |

**Repro**

1. Home has a next session and no `active_workout`.
2. `GET /workouts` returns 500.
3. Tap **START DAY**.

**Evidence**

The merge sheet does not open. `POST /programs/prog-1/start-day` runs with `{ week_index: 1, day_index: 1 }`. The app navigates to `/workout/w-dup`. No start error is shown. The same catch exists in `frontend/app/program.tsx` `startDay`.

Backend `start_program_day` always inserts a workout with `ended_at: null`. If an open session existed and the list call failed, that insert is a second open session. The merge sheet is only reached when the list returns a row.

Related, source-checked, and the button was on screen: check-in **START WORKOUT** (`frontend/app/checkin.tsx` `goTrain`) calls `createWorkout` whenever `home/today` has no `active_workout`. It never asks the workout list. Shot of the button: `checkin-result-390.jpg`.

**Expected**

A failed session list stops the create and shows a retry. Start day runs only after the athlete knows whether a session is already open. The merge sheet remains the path when the list returns an open row.

**Impact**

Two live workouts. Sets land in whichever one was opened last. Home’s “the” session becomes ambiguous. The open session is not deleted, and it is also no longer the obvious one.

**Minimal fix**

In both `startDay` functions, a thrown `api.workouts()` sets `startError` and returns before `startProgramDay`. Check-in uses the same helper: resume the open id, or show the error, before `createWorkout`.

**Regression test**

Home fixture with `next_session` and `GET /workouts` 500. Tap `today-start-day`. Assert the start-day POST count is 0, `merge-session-sheet` is absent, and `start-error` is visible. A second test returns one open workout and asserts the sheet appears and start-day is still 0 until **NEW SESSION**.

### A-05 — A finished session with no duration reads as 0 minutes

| | |
|---|---|
| ID | A-05 |
| Severity | P1 |
| Kind | Verified defect |
| Screen | Workout tab, session row |
| File | `frontend/app/(tabs)/workouts.tsx` `sessionMeta` |

**Repro**

1. Open the Workout tab.
2. Include a finished workout whose `duration_sec` is null and `ended_at` is set.

**Evidence**

The row for Pull day renders `10/9/2026 · 0 min`. The in-progress row correctly says “in progress” and does not invent a duration. Shot: `docs/release/bot-a/sessions-open-1440.jpg`.

`sessionMeta` uses `Math.round((item.duration_sec ?? 0) / 60)`. Null and missing both become 0. Finish itself computes a duration when `started_at` exists (`backend/server.py` `finish_workout`). The list still lies for any finished row that has no duration, including a copy or import.

The session row is also unnamed: `workout-w-live` has no `role` and no accessible name (same shot). That part is A-12.

**Expected**

A missing duration is an em dash or “Duration unknown”. A recorded 0 seconds can still read as 0 min.

**Impact**

Breaks the rule that an unknown metric is never zero. The athlete reads a session that has no stored length as a session that lasted no time.

**Minimal fix**

If `ended_at` is set and `duration_sec` is not a finite number, omit the minute figure. Keep `0` only when `duration_sec === 0`.

**Regression test**

Fixture with `duration_sec: null` and `ended_at` set. Assert `workout-meta-*` contains no `0 min`. A row with `duration_sec: 0` may show 0 min. A row with `duration_sec: 2400` shows 40 min.

### A-06 — Check-in success invents a reward distance

| | |
|---|---|
| ID | A-06 |
| Severity | P2 |
| Kind | Verified defect |
| Screen | Gym check-in result |
| File | `frontend/app/checkin.tsx` (result meta, the `visits_until_reward` lines) |

**Repro**

1. Open Check-in with one partner gym.
2. Check in. Response includes `total_visits: 3` and `reward_unlocked: false`, and omits `visits_until_reward`.

**Evidence**

The card reads “Visit #3 · **NaN** more for a reward” and “**0 visits until reward**”. Shot: `docs/release/bot-a/checkin-result-390.jpg`.

`formatNumber(result.visits_until_reward)` is NaN when the field is missing. The next line uses `result.visits_until_reward ?? 0`, so the unknown count becomes 0. The current gym handler does send the field (`backend/routers/gyms.py`). The client still has both bugs for any response that omits it.

When the field is 7, the same card prints both “7 more for a reward” and “7 visits until reward”. That duplicate is a preference, listed below. It is not a wrong number.

**Expected**

If the count is absent, the reward sentence is omitted. A returned 7 is shown once. A returned 0, meaning the reward interval was just hit, stays 0 and sits with the reward-unlocked state.

**Impact**

A successful check-in can tell the athlete the reward is due now (`0 visits`) and also show a broken **NaN**. That is an unknown metric rendered as zero, plus a nonsense figure, on a confirmation.

**Minimal fix**

Render the distance only when `typeof visits_until_reward === "number"`. Delete the `?? 0` fallback. Keep a single sentence.

**Regression test**

Omit the field: assert the result text has neither `NaN` nor `0 visits`. Include `7`: assert one “7” reward sentence.

### A-07 — A plan the client cannot read looks like no plan

| | |
|---|---|
| ID | A-07 |
| Severity | P2 |
| Kind | Verified defect |
| Screen | Plan |
| File | `frontend/app/program.tsx` `load` (`ProgramSchema.safeParse` failure falls through with `program` still null) |

**Repro**

1. `GET /programs` returns one active program whose exercise is missing `target_rpe` and `rest_sec` (the client schema requires both).
2. Open `/program`.

**Evidence**

The screen is the generator: goal, level, days, equipment, **GENERATE 4-WEEK PROGRAM**. `program-load-error` is absent. `day-card-1` is absent. Shot: `docs/release/bot-a/program-unreadable-390.jpg`. Text captured on that render starts at “Plan” and ends at “GENERATE 4-WEEK PROGRAM”.

`generate_program` archives every active program for the user before inserting the new one (`backend/routers/program.py`, `update_many` status `archived`). A network failure on this screen already shows retry and hides the generator. A schema miss does not.

**Expected**

An active document that fails client validation shows an error and retry, and does not offer Generate as if the athlete had no plan.

**Impact**

The athlete can replace a stored plan because the app said there wasn’t one. The archived plan is the data loss. Workout sets already logged are untouched.

**Minimal fix**

If `active` exists and `safeParse` fails, set `program-load-error` and skip the generator. Generate stays behind an explicit replace confirm when a plan is loaded.

**Regression test**

Return an active program that fails `ProgramSchema`. Assert `generate-btn` is absent and `program-load-error` is visible. A schema-valid plan still shows `day-card-1`.

### A-08 — Sign-in shows a JavaScript exception when the login response is not JSON

| | |
|---|---|
| ID | A-08 |
| Severity | P2 |
| Kind | Verified defect |
| Screen | Auth |
| File | `frontend/src/auth-context.tsx` `login` (`r.access_token` with no guard); `frontend/src/api.ts` `request` returns a null body on a 200 that does not parse as JSON |

**Repro**

1. Open `/auth`.
2. Submit an email and a password.
3. `POST /auth/login` returns HTTP 200 with `text/html` (what Expo web returns for `/api/*` when no backend is mounted: `Content-Type: text/html`, the SPA document).

**Evidence**

`auth-error` reads `Cannot read properties of null (reading 'access_token')`. A real 401 still reads “Incorrect email or password” (`auth-error-390.jpg`), so the form can show a server message. The HTML 200 path does not.

**Expected**

Any login response that lacks `access_token` shows a human sentence such as “Could not sign in. Try again.” The stack fragment never appears.

**Impact**

The first step of the athlete journey, against a web host that is not routing `/api`, looks broken in a way the athlete cannot act on. A wrong password is already handled.

**Minimal fix**

In `request`, a 200 whose body is not an object throws a normal `Error` with a short message. `login` checks `r?.access_token` before `setToken`.

**Regression test**

Mock login 200 with `content-type: text/html`. Submit the form. Assert `auth-error` does not contain `access_token`, and the URL is still `/auth`.

### A-09 — “Placeholder” is on the sign-in screen and on every library tile

| | |
|---|---|
| ID | A-09 |
| Severity | P2 |
| Kind | Verified defect |
| Screen | Auth; Workout library |
| File | `frontend/app/auth.tsx` (the text node `Placeholder`); `frontend/src/components/night/coach-mark.tsx` `PosterPlate` |

**Repro**

1. Open `/auth` signed out.
2. Open the Workout tab, Library, with two exercises and no poster image.

**Evidence**

Auth DOM text begins with the word **Placeholder** under the app icon (`auth-390.jpg`, `auth-register-390.jpg`). The node is a `Text` at 12px, `colors.textDim`, not `accessibilityElementsHidden`.

Library tiles render the word **Placeholder** twice at 1440 (one per exercise), above the exercise name, with the app icon. `docs/release/bot-a/library-placeholder-1440.jpg`. Home’s stage does not use that word (checked: Home body text has no “Placeholder”).

**Expected**

Sign-in shows the mark and the word IRONFLOW. Library tiles name the exercise. A missing photo is a flat plate, without the word Placeholder.

**Impact**

The first screen and the exercise browser look unfinished. Athletes can read the string as a broken image label.

**Minimal fix**

Remove the `Placeholder` text in `auth.tsx`. In `PosterPlate`, drop the kicker string. Keep the plate color and the exercise name.

**Regression test**

Signed-out `/auth` and the library tab: `getByText("Placeholder")` has count 0. The exercise name is still visible.

### A-10 — Settings marks French while the app is running in English

| | |
|---|---|
| ID | A-10 |
| Severity | P2 |
| Kind | Verified defect |
| Screen | Settings, language |
| File | `frontend/app/settings.tsx` (`user?.preferred_locale ?? "fr"`); running locale is `user?.preferred_locale ?? initialLocale` in `frontend/src/i18n.tsx` |

**Repro**

1. Sign in as an athlete whose profile has no `preferred_locale`.
2. Device language is English (this run: Chromium `en-US`).
3. Open Settings and read the language grid.

**Evidence**

The rest of Settings is English (“SETTINGS”, “Training plan”, “SIGN OUT” path). The French option’s accessible text is `FRANÇAIS` plus a checkmark. English has no checkmark. Both chips compute to the same fill, `rgb(36, 42, 49)`. Neither exposes `aria-checked`, even though the role is `radio`. Shot: `docs/release/bot-a/settings-1440.jpg`.

`initialLocale` follows the device and falls back to French only when the device language is unsupported. The Settings check uses French whenever `preferred_locale` is missing, including for an English device.

**Expected**

The checked language is the language on screen. A radio exposes `aria-checked`. The selected chip is visually distinct.

**Impact**

An athlete who has never saved a language sees French selected while the UI is English. Changing nothing is confusing. Saving from that screen can write French over an English session if they tap the checked row, or they “fix” it by tapping English and issuing a profile write they did not intend as a change.

**Minimal fix**

Select `user?.preferred_locale ?? locale` from `useI18n()`, the same value `I18nProvider` is using. Pass `accessibilityState.checked` through to the web radio (the role is already set; the state is not reaching `aria-checked`).

**Regression test**

`/auth/me` without `preferred_locale`, browser locale `en-US`. Assert the English option is the one with the check, and `language-en` has `aria-checked="true"`. A profile with `preferred_locale: "fr"` checks French and the UI strings are French.

### A-11 — Sign-in controls and the error are weakly exposed

| | |
|---|---|
| ID | A-11 |
| Severity | P2 |
| Kind | Verified defect |
| Screen | Auth |
| File | `frontend/app/auth.tsx` |

**Repro**

1. Open `/auth`.
2. Inspect **SIGN IN**, submit a wrong password, then switch to create-account and inspect the Athlete chip.

**Evidence**

`auth-submit-btn` has `role` null and no accessible name (the visible text is inside a child `Text`). `auth-error` has `role` null after “Incorrect email or password”. `role-athlete-btn` has `role` null, `aria-checked` null, and `aria-pressed` null while Athlete is the selected role. The switch link does set `accessibilityRole="button"`.

**Expected**

Submit is a button named “Sign in” or “Create account”. The error has `role="alert"`. The selected role chip exposes selected state.

**Impact**

A keyboard or screen-reader user on the gate can miss the error and cannot tell which role is selected.

**Minimal fix**

`accessibilityRole="button"` and an explicit label on submit. `accessibilityRole="alert"` on `auth-error`. `accessibilityRole="radio"` plus `accessibilityState={{ selected }}` on the two chips.

**Regression test**

Playwright `toHaveRole` / `getAttribute('aria-checked')` on those three test ids after a 401.

### A-12 — Session rows have no accessible name

| | |
|---|---|
| ID | A-12 |
| Severity | P2 |
| Kind | Verified defect |
| Screen | Workout tab |
| File | `frontend/app/(tabs)/workouts.tsx` session `Pressable` (`testID={`workout-${item.id}`}`) |

**Repro**

1. Open the session list with one in-progress workout.

**Evidence**

`workout-w-live` `role` is null and `aria-label` is null. The visible title is “Push day” and the meta says “in progress”. The new-session control does expose “NEW SESSION”.

**Expected**

The row is a button named with the title and the status (“Push day, in progress”).

**Impact**

The list of sessions, including the live one, is weaker for assistive tech than the button that creates another session (A-13).

**Minimal fix**

`accessibilityRole="button"` and `accessibilityLabel` built from `item.title` and `sessionMeta(item)`.

**Regression test**

`workout-w-live` has accessible name matching `/Push day/i` and `/in progress/i`.

### A-13 — New session does not mention the workout already in progress

| | |
|---|---|
| ID | A-13 |
| Severity | P2 |
| Kind | Verified defect |
| Screen | Workout tab |
| File | `frontend/app/(tabs)/workouts.tsx` `createDated` / `fab-new-workout` |

**Repro**

1. Session list contains an in-progress workout (“Push day”).
2. Tap **NEW SESSION** (the full-width control, library selection empty).

**Evidence**

The client posts `POST /workouts` with title `Session · Sat, Oct 10` and an empty plan, then opens `/workout/w-extra`. No merge sheet. The in-progress row is still in the list above the button (`sessions-open-1440.jpg`). Home, in the same situation, offers only Resume (A-01’s sibling that already holds).

**Expected**

The primary control on a list that already has an open session resumes that session, or asks before creating another. **NEW SESSION** can remain as the explicit second action.

**Impact**

A second empty workout is one tap away from the screen whose job is to show the open one. Sets can split across the two ids. The first workout remains.

**Minimal fix**

If any loaded row has no `ended_at`, the filled button resumes it. Creating another session uses the same merge sheet as Home and Plan.

**Regression test**

List with one open workout. Assert `fab-new-workout` navigates to that id and that `POST /workouts` is not called. A list of only finished workouts still creates.

### A-14 — The finish summary says “1 sets”

| | |
|---|---|
| ID | A-14 |
| Severity | P3 |
| Kind | Verified defect |
| Screen | Logger, session complete |
| File | `frontend/app/workout/[id].tsx` share summary (`t("{count} sets")`) |

**Repro**

Finish a session that has one logged set.

**Evidence**

Summary text: `1 sets · 40 min · 400 kg`. `logger-finished-390.jpg`. Home’s plan line already pluralizes (“1 exercise” on `home-plan-390.jpg`). The summary key does not.

**Expected**

“1 set · 40 min · 400 kg”. Two or more use “sets”.

**Impact**

The completion line, which is the athlete’s receipt, is grammatically wrong in English. The numbers themselves matched the logged set (5×80 = 400 kg) and the mocked 2400-second duration (40 min).

**Minimal fix**

The same count ternary Home uses for exercises.

**Regression test**

Finish with one set: summary matches `/1 set\b/`. Finish with two: `/2 sets/`.

## Preferences (not defects)

These match the code and the render. They are product judgment. They are not in the fix-before-release list.

| Topic | What the app does | Why it stays a preference |
|---|---|---|
| Community first screen | With no club, the pitch “Find your people…” and **FIND A CLUB** sit above the feed. On 390×844 the feed box starts at y=358, so the empty state “No posts yet. Share your first session.” is on the first screen. `community-390.jpg` | The empty state names the situation and offers a next action. An athlete who already has a club gets **YOUR CLUB** in source (`hasClub` branch). This pass rendered the no-club case. |
| Reward copy when the count exists | “7 more for a reward” and “7 visits until reward” both show. | The number is the server’s number. One sentence would be clearer. It is not a false zero. |
| Morning sleep slider | Opens at **8 h**. Soreness and mood start unset, and Save stays disabled until both are chosen. `morning-390.jpg` | 8 hours is visible before save. It is a default on a labeled slider, not a hidden metric. |
| Library “Play demo” | The words are visible. Posters are plates because this repo has no licensed photos. | The word Placeholder on those plates is A-09. The demo control itself is fine. |

## Out of scope and limits

- Staff console (`frontend/staff/**`, `frontend/src/components/admin/**`) was not opened for this audit.
- No live API, so OAuth connect, lab upload bytes, camera QR, and GPS record were not completed against a server. Check-in on web used the gym-list button, which the screen shows when `Platform.OS === "web"`.
- iOS and Android were not installed or launched. Keyboard overlap on the logger, safe area, and a killed-app resume of the offline queue were not executed. The queue module writes through the app storage helper; this pass only saw the web session.
- Double-tapping add in Playwright produced set indexes 1 and 2, so a same-index double post was not reproduced.
- The merge sheet when `GET /workouts` returns an open row is still implemented on Home and Plan. This pass proved the opposite path (the list errors, and create runs anyway): A-04.

## Screenshot index

| File | What it shows |
|---|---|
| `auth-390.jpg`, `auth-register-390.jpg` | Sign-in and create-account. DOM includes the word Placeholder. |
| `auth-error-390.jpg` | Wrong password: “Incorrect email or password”. |
| `home-plan-390.jpg` | Today’s session, Start day, readiness as guidance, meters labeled Measured. |
| `home-unknown-390.jpg` | Em dash, Not connected, no wearable. |
| `home-sample-390.jpg` | Simulated 0 and 80 labeled Sample data. |
| `home-resume-1440.jpg` | Resume only, desktop board. |
| `home-error-390.jpg` | Home 500 and Retry. |
| `logger-open-390.jpg` | Defaults 8 / 60 / 7. |
| `logger-sync-fail-390.jpg` | Pending set, Retry sync, finish blocked. |
| `logger-after-retry-390.jpg` | A-01 after the post succeeds. |
| `logger-finished-390.jpg` | “1 sets · 40 min · 400 kg”. |
| `sessions-open-1440.jpg` | In progress, and a finished row “0 min”. |
| `library-placeholder-1440.jpg` | Placeholder on exercise tiles. |
| `settings-1440.jpg` | Training links; French checked for an English UI. |
| `labs-error-390.jpg` | Labs error and retry. |
| `sources-390.jpg` | Whoop LIVE, Garmin SAMPLE DATA. |
| `checkin-result-390.jpg` | NaN and “0 visits until reward”. |
| `community-390.jpg` | No-club community, find-a-club, empty feed. |
| `trends-390.jpg` | Gap copy, 30 / 90 days. |
| `program-week4-390.jpg` | Adjust week 4. |
| `program-unreadable-390.jpg` | Generator shown for an unreadable active plan. |
| `morning-390.jpg` | Sleep 8 h, soreness and mood unset. |
