# Bot E — implementation plan for Bot C

Plan only. No application code is changed on this branch.

Baseline is `main` at **`9604bac`** (`Upgrade Expo SDK 54 to 57 for Expo Go`). Main runs locally and is not deployed. GitHub pull requests are refused; the coordinator merges from the owner's PC. Bot C implements this plan on a branch and pushes it. Bot C does not open a pull request and does not deploy.

## What this plan is built from

| Source | Branch | What landed here |
|---|---|---|
| Bot A audit | `origin/release/bot-a-audit` | `docs/release/bot-a-findings.md` (A-01..A-14) |
| Bot B visual | `origin/release/bot-b-visual` | `docs/release/bot-b-visual.md` and the twelve SVGs in `docs/release/bot-b/art/` |
| Bot D review | `origin/release/bot-d-review` | `docs/release/bot-d-findings-review.md` |

Screenshots, `capture.mjs`, and `measurements.json` stay on the finding branches. They are evidence, not inputs Bot C should import.

**Bot D's verdict and severity win** wherever A or B disagree. The four places this plan narrows a proposed fix, and why, are in [Documented disagreements](#documented-disagreements).

## In scope

Every P1, every P2, D-01, D-02, D-03, B-1, B-2, B-6, and the staff-menu test helper. The helper is in scope because it is the root cause of the historical red mobile runs, not because the drawer is stuck.

| ID | Final severity | One line |
|---|---|---|
| A-01 | P1 | After a set syncs, the row still says Saving and finish still says it is closed |
| A-02 | P1 | A late previous-sets response overwrites numbers the athlete typed |
| A-03 | P1 | A logger with no history opens on 8 / 60 / 7 and one tap logs them |
| A-04 | P1 | A failed session list is treated as "nothing open", so Start day creates another workout |
| A-05 | P1 | A finished session with `duration_sec: null` renders as 0 min |
| A-07 | P1 | A plan the client schema rejects looks like no plan and offers Generate, which archives the active plan |
| D-01 | P2 | The finish receipt turns a null duration into 0 min. A-05 does not fix this |
| D-02 | P2 | `finish_workout` stores 0 when `started_at` is missing, so the client cannot tell unknown from a real zero |
| A-06 | P2 | A missing reward distance renders as NaN and as 0 visits |
| A-08 | P2 | A non-JSON login 200 throws on `access_token` and stays on `/auth` |
| A-09 | P2 | The word Placeholder is on sign-in and on library plates. Same root as B-1 |
| A-10 | P2 | Settings checks French while the UI is English, and the radio has no `aria-checked` |
| A-11 | P2 | Sign-in submit, the error, and the role chip are weakly exposed on web |
| A-12 | P2 | A session row has no accessible name |
| A-13 | P2 | New session creates a second workout while one is already open |
| B-1 | P2 | Replace the Expo template mark with the member glyphs. Do not change the staff favicon |
| B-2 | P2 | The wordmark is system-ui at weight 900, and the form overlaps the hero |
| B-6 | P2 | Sign-in and session-list error sentences use `colors.error` at 4.34:1 |
| D-03 | P2 | On this web build, `accessibilityState` does not become `aria-checked` or `aria-expanded` |
| Staff helper | P2 (test) | `frontend/e2e/staff-nav.ts` clicks Menu a second time and closes a drawer that is already open |

## Out of scope

These stay deferred. Bot C does not implement them "while the file is open."

| ID | Final severity | Leave it alone |
|---|---|---|
| A-14 | P3 | "1 sets" on the receipt. D-01 may change the minutes segment only. Do not touch the `{count} sets` key or the tonnage math |
| B-3 | P3 | Demo-sheet simulation sentence, movement plate on that stage, and the 44px close control |
| B-4 | P3 | Rest-timer brand border, and `volt` / `blaze` on tip icons |
| B-5 | P3 | Logger column cap at 640. Do not lower Home's 1120 shell to chase it |
| B-7 | P3 | 10–11px labels |
| B-8 | P3 | Tip carousel 8s auto-advance |
| B-9 | P3 | Any other member sentence still on `colors.error` (labs, messages, friends, live, notification settings, and the rest). A repo-wide replace is forbidden; see B-6 |
| B-10 | P3 | Broader `design_guidelines.json` work. The three stock URLs and the "marked Placeholder" sentence are the exception, and they move only inside the B-1 commit (see disagreements) |
| B-11 | P3 | Italic on "No sets logged yet." and the flame glyph on the streak |

Also out of scope: staff layout, staff tokens, staff sign-in mark, `frontend/staff/auth.tsx`, `frontend/app.config.js`, rasterizing `icon.png` / `adaptive-icon.png` / `splash-image.png` / `favicon.png`, check-in `goTrain`, `backend/routers/program.py` archive behavior, `backend/routers/gyms.py` (it already sends `visits_until_reward`), native iOS and Android, and any preference Bot A listed as not a defect (community empty pitch, morning sleep default of 8 h, Play demo copy).

What already holds and must stay: unknown readiness and missing wearables render as an em dash; a simulated 0 stays 0 and says Sample data; an in-progress row does not say 0 min; a wrong password still says "Incorrect email or password"; Finish stays closed while a set is actually queued.

## Fix-risk constraints (read before editing)

1. **A-01.** Clear only the sync-closed alert ("Could not sync sets. Finish stays closed until they land.") and its companion logger line ("Could not sync your sets. They are still here."). A later empty flush must not wipe "Session did not finish. Try again."
2. **A-01 rows.** Replace `local-*` rows by re-reading sets and passing them through the existing `mergeServerSets`. Do not drop a local row before that read returns.
3. **A-02 and A-03 ship together.** The invented 8 / 60 / 7 defaults are not edits. Reset dirty flags when the exercise or the set index changes.
4. **A-04 is not check-in.** `goTrain` in `frontend/app/checkin.tsx` resumes `homeToday().active_workout` and does not call `api.workouts()`. Do not route check-in through the fail-closed helper. A down session list must not turn a successful check-in into a dead end when Today already said nothing is open.
5. **A-13.** Do not route a row whose `activity` is set into `/workout/`. Those rows already open `/record/{id}`. If two rows are open, name them. Do not `find` the first.
6. **Glyphs are member-only.** Copy path data into a member module. Do not import from `docs/`. Do not ship `docs/design-refs/portrait-coach.svg` or invent a face. Unknown equipment uses a neutral plate, not the barbell. Do not change the shared favicon or the staff chevron.
7. **Do not repo-wide replace `colors.error`.** Change the two sentence styles named under B-6. Staff files alias `staffColors` as `colors` (`operations-overview.tsx`, reports, coaches, users, and the other admin tabs). A global replace recolors staff marks.
8. **On web, set `aria-checked` and `aria-expanded`.** `react-native-web` maps those props. It does not unpack `accessibilityState`. Keep `accessibilityState` for native, and add the `aria-*` prop for web. `Affordance` already spreads extra props onto `Pressable`.

## File ownership

Touch a file only for the items in its row. `workout/[id].tsx`, `program.tsx`, `workouts.tsx`, and `auth.tsx` are each edited once, in the order below.

| Files | Items | Do not also change |
|---|---|---|
| `frontend/app/workout/[id].tsx` | A-03, A-02, A-01, D-01 | `offline-queue.ts`, rest-timer border, logger width, italic empty line, `{count} sets` |
| `frontend/src/open-session.ts` (new), `frontend/app/(tabs)/home.tsx`, `frontend/app/program.tsx` | A-04, A-07 | `checkin.tsx`, `backend/routers/program.py` |
| `frontend/app/(tabs)/workouts.tsx` | A-05, A-12, A-13, B-6 list sentence, B-1 plate `equipment` prop | Home shell width, library filter colors |
| `backend/server.py` `finish_workout`, `backend/tests/test_analytics.py` | D-02 | No migration of rows already stored as 0 |
| `frontend/app/checkin.tsx` | A-06 | `goTrain` |
| `frontend/src/api.ts`, `frontend/src/auth-context.tsx` | A-08 | Do not throw on an empty 204 |
| `frontend/app/auth.tsx`, `frontend/src/components/night/coach-mark.tsx`, `frontend/src/components/night/plate-glyphs.tsx` (new), `design_guidelines.json` (two deletions only) | A-09, A-11, B-1, B-2, B-6 auth sentence | `frontend/staff/**`, `frontend/app.config.js`, `frontend/assets/images/**` |
| `frontend/app/settings.tsx` | A-10, D-03 `aria-checked` | Chip fill and border |
| `frontend/staff/index.tsx` | D-03 `aria-expanded` on `admin-nav-menu` only | Staff layout, tokens, copy |
| `frontend/e2e/staff-nav.ts` | Historical flake | Do not "fix" the flake by changing staff layout |
| `frontend/e2e/release-athlete.spec.ts` (new) | The member regression tests below | Do not weaken `wave-a.spec.ts` or `athlete-night-studio.spec.ts` |

`CoachMark` is also rendered from `home.tsx`, `morning.tsx`, and `coach/chat.tsx`. Those callers stay as they are. The drawing change lives in `coach-mark.tsx`.

## Tests Bot C must add

Member UI: one new Playwright file, `frontend/e2e/release-athlete.spec.ts`, copying the local `signIn` plus mocked `/api` style from `frontend/e2e/athlete-night-studio.spec.ts`. Locale `en-US`. Desktop project is 1440×900. The 390 case for B-2 uses the mobile project. Do not point these tests at a live backend.

Staff: keep using `frontend/e2e/admin.spec.ts`. The helper proof is the mobile project.

Backend: extend `backend/tests/test_analytics.py` with the same `run_isolated` pattern as `test_finishing_a_workout_records_one_completion`. From `backend/`: `python -m pytest tests/test_analytics.py -q --tb=line -n 0`. That file needs local MongoDB, which the existing test already requires.

Commands, from `frontend/`:

```bash
npx playwright test e2e/release-athlete.spec.ts --project=desktop
npx playwright test e2e/release-athlete.spec.ts --project=mobile -g "B-2"
npx playwright test e2e/admin.spec.ts --project=mobile -g "moderator resolves a report and must give a reason to suspend|audit tab shows who did what|support queue can hide assigned tickets"
```

Asserting only that `offline-banner` is gone does not catch A-01. That banner already hides when the queue hits zero.

## Ordered work

### 1. A-03 — Logger opens empty when there is no history

**Files.** `frontend/app/workout/[id].tsx`. Initial state is `useState("8")`, `useState("60")`, `useState("7")` around lines 165–168.

**Fix.** Initial reps, weight, and RPE are empty strings. `quickAddSet` already refuses a blank rep or a non-numeric weight and sets `add-set-error`. Do not substitute another default, including a hidden RPE. An empty RPE already becomes `null` on a real add (`Number.isNaN`).

**Test.** Open a logger whose `previous-sets` sessions are empty. `input-reps`, `input-weight`, and `input-rpe` are empty. Press `add-set-btn` without typing. No `POST /workouts/{id}/sets`.

### 2. A-02 — Previous-sets fills untouched fields only

**Files.** Same file. The effect is about lines 329–354. It always calls `setReps`, `setWeight`, and `setRpe`. Ship this in the same edit as A-03.

**Fix.** A dirty flag per field, set from that field's `onChange`, cleared when the exercise id or `nextSetIndex` changes. Apply a server hint only while the flag is still false. Empty fields from A-03 are not dirty, so a hint may fill them. "Last time" still updates from the payload. Do not treat the old 8 / 60 / 7 defaults as edits.

**Test.** Delay `previous-sets` (set 1 = 3 reps, 40 kg, RPE 6). Fill 12 and 100. Release the response. Inputs stay 12 and 100, and "Last time" still mentions 40 kg. A second case with no typing becomes 3 and 40.

### 3. A-01 — Clear only the sync-closed alert, then merge server sets

**Files.** Same file. `finish` sets `finishError` and `loggerError` when `pendingFor(id) > 0` (about lines 432–436). `logger-retry-sync` and the row retry call `flushQueue()` and never clear those strings. `isOptimisticSet` stays true while the id starts with `local-`. `mergeServerSets` (lines 142–148) already keeps a local row the server list does not contain. `load` merges sets but does not clear `finishError`.

**Fix.** When a flush leaves `pendingFor(this workout) === 0`, clear `finishError` only if it is the sync-closed sentence, and clear `loggerError` only if it is the companion sync sentence. Then `api.listSets` and `setSets(mergeServerSets(server, setsRef.current))`. If that read throws, leave the local rows on screen. Do not filter them out first. The same path runs from Retry sync and from `finish` after a flush that actually emptied the queue. A flush that finds "Session did not finish. Try again." leaves that sentence in place.

**Test.** Fail set POSTs until after the blocked Finish (`finish-error` visible, `share-panel` absent). Let the retry succeed with `{ reps: 5, weight_kg: 80 }`. The row does not say Saving, `finish-error` is gone, the inputs or the row are still 5 × 80, and the next Finish shows `share-panel`. A separate case where finish itself fails with "Session did not finish." stays on that sentence after a later empty flush.

### 4. D-01 — Null duration on the receipt is not 0 min

**Files.** Same file, in the same edit. `finish` sets `minutes: Math.max(0, Math.round(Number(result.duration_sec) || 0) / 60)`. `Number(null) || 0` is 0. The receipt is `session-summary`.

**Fix.** Same rule as A-05. `duration_sec === 0` stays 0 minutes. `null` and a non-finite value omit the minutes (an em dash or "Duration unknown"). Do not invent minutes from the client clock when the server omitted them. Do not change the sets plural (A-14) or the tonnage sum.

**Test.** Finish JSON `duration_sec: null`: `session-summary` has no `0 min`. `duration_sec: 0` may show 0 min. `duration_sec: 2400` shows 40 min.

### 5. A-04 — Home and Plan fail closed when the session list fails

**Files.** New `frontend/src/open-session.ts`. Callers: `startDay` in `frontend/app/(tabs)/home.tsx` (the catch at lines 220–222 sets `open` to undefined, then `startProgramDay` runs) and `startDay` in `frontend/app/program.tsx` (the catch at lines 245–247 does the same). Not `frontend/app/checkin.tsx`.

**Fix.** The helper calls `api.workouts()` and returns every row with no `ended_at`. If the call throws, the throw propagates. Home and Plan catch it, set a visible error, and return. They do not POST start-day and they do not open `merge-session-sheet`. Home already has `start-error`. Plan today uses `Alert.alert`, which Playwright will not see reliably; add a visible `program-start-error` and do not depend on the alert. One open lift still shows the existing merge sheet and does not start a second session until New session (`merge-new-session`). Two open rows are named, not `find` of the first. A row with `activity` set is resumed at `/record/{id}` or named in the sheet, and is never pushed to `/workout/`. That last rule is A-13's constraint applied here so the helper cannot reintroduce it.

**Test.** Home: `next_session` present, `GET /workouts` 500. `today-start-day` sends no start-day POST, `merge-session-sheet` is absent, `start-error` is visible. Repeat on Plan `start-day-1` (`program-start-error` visible, no POST, no merge sheet). A list that returns one open lift still shows the merge sheet and does not start a second session until New session.

### 6. A-07 — An unreadable active plan is an error, not an empty plan

**Files.** `load` in `frontend/app/program.tsx` (lines 159–183). `ProgramSchema` in `frontend/src/program-schema.ts` requires `target_rpe` and `rest_sec`. On `safeParse` failure, `program` stays null and `loadError` is not set, so the screen falls through to `generate-btn`. `generate_program` in `backend/routers/program.py` archives every active program before insert. Do not change that backend function. The client must stop offering the button on this path.

**Fix.** When the active document fails `ProgramSchema`, set `loadError`, leave `program` null, and show the existing `program-load-error` plus `program-load-retry`. That branch already hides Generate (`loadError && !program`). Do not hide Generate without the error. Do not loosen the schema. Do not auto-archive. Logged sets stay untouched. An explicit replace, behind a confirm that names the archive, is not part of this fix.

**Test.** Active program whose exercise omits `target_rpe` and `rest_sec`: `generate-btn` absent, `program-load-error` visible. A schema-valid plan still shows `day-card-1`.

### 7. A-05 — Null duration on the session list is not 0 min

**Files.** `sessionMeta` in `frontend/app/(tabs)/workouts.tsx` (lines 164–168). It uses `duration_sec ?? 0`. The meta node is `workout-meta-${id}`.

**Fix.** Keep 0 only when `duration_sec === 0`. A null or non-finite value omits the minutes. An open row (`ended_at` missing) stays "in progress" and does not say 0 min. A-12's accessible name must call this same function, so land A-05 before A-12 in this file.

**Test.** `duration_sec: null` with `ended_at` set: `workout-meta-*` has no `0 min`. `duration_sec: 0` may show 0 min. `duration_sec: 2400` shows 40 min. An open row still matches `/in progress/i` and does not match `0 min`.

### 8. D-02 — Store null duration when the workout has no start time

**Files.** `finish_workout` in `backend/server.py` (about line 840): `duration = int((ended - w["started_at"]).total_seconds()) if w.get("started_at") else 0`. Test in `backend/tests/test_analytics.py`.

**Fix.** When `started_at` is missing, store `duration_sec: null`. Do not write 0. `training_load.session_load` already returns `None` for a missing duration, so `load_au` stays unset. A workout that has `started_at` still stores the computed seconds. Do not repair rows already stored as 0. Do not change the early return that hands back an already-finished workout.

**Test.** Pytest, same harness as `test_finishing_a_workout_records_one_completion`. A finish whose workout has no `started_at` returns `duration_sec: null` and does not persist `load_au`. A workout with `started_at` still returns a computed duration (the existing test's "about 20 minutes" assertion must keep passing). The list and the receipt do not show 0 min for a null duration; that half is the A-05 and D-01 Playwright tests, not a live backend. Do not start the API server for this item.

### 9. A-06 — Reward distance only when the number is real

**Files.** `frontend/app/checkin.tsx` result meta (lines 209–217). `formatNumber(undefined)` is the string `NaN`. The next line uses `visits_until_reward ?? 0`. `backend/routers/gyms.py` does send the field today; the client still lies when it is absent. Do not change `goTrain`.

**Fix.** Render the distance only when the value is a finite number. Delete `?? 0`. When the number exists, one reward sentence, not both "N more for a reward" and "N visits until reward". A returned 0 with `reward_unlocked: true` stays 0 next to the unlocked state. Do not invent a distance.

**Test.** Omit the field: `checkin-result` has neither `NaN` nor `0 visits`. Include 7: one reward sentence. Include 0 with `reward_unlocked: true`: the zero stays and the unlocked state stays.

### 10. A-08 — A non-JSON login does not sign the athlete in

**Files.** `request` in `frontend/src/api.ts` (lines 922–945) returns `null` when `JSON.parse` fails on a 2xx. `login` and `register` in `frontend/src/auth-context.tsx` read `r.access_token` with no guard.

**Fix.** A 2xx whose body is non-empty and is not JSON throws a short sentence from `request`. An empty 204 still returns `null`, because deletes, typing, and onboarding depend on that (see disagreements). `login` and `register` call `setToken` only when `access_token` is a string; otherwise they throw the short sentence and do not set the user. A real 401 still throws the server `detail` (`Incorrect email or password`).

**Test.** Login 200 with `content-type: text/html`. `auth-error` does not contain `access_token`. URL stays `/auth`. A 401 fixture still shows the server sentence.

### 11. A-11 — Sign-in exposes the button, the alert, and the selected role

**Files.** `frontend/app/auth.tsx`. `auth-submit-btn` has no role. `auth-error` has no role. `role-athlete-btn` exists only in register mode and has no checked state. Do not restyle `frontend/staff/auth.tsx`.

**Fix.** `accessibilityRole="button"` and an accessible name matching the visible label ("Sign in" or "Create account") on submit. `accessibilityRole="alert"` on `auth-error`. On the role chips, `accessibilityRole="radio"` plus `aria-checked={role === r}` (and keep `accessibilityState` for native). `accessibilityState` alone will not show up on this web build (D-03).

**Test.** After a 401: `auth-submit-btn` has role button and an accessible name matching Sign in, and `auth-error` has role alert. Then switch to create-account: `role-athlete-btn` exposes the selected state in `aria-checked` (Athlete is the default). The chip is not on the login screen; do not fail the test for that.

### 12. B-6 — Two error sentences move to `errorText`

**Files.** `styles.err` in `frontend/app/auth.tsx` (`color: colors.error`) and `styles.createError` in `frontend/app/(tabs)/workouts.tsx` (same token, 12px). The token to use is `colors.errorText` (`#FFB4AE`) from `frontend/src/palette.ts`. Home and sources failure copy already use the readable pattern. Leave them.

**Fix.** Change those two sentence styles only. Leave large marks and icon strokes on `colors.error`. Do not search-and-replace `colors.error`. Do not edit files that alias `staffColors` as `colors`.

**Test.** `auth-error` computed color is `rgb(255, 180, 174)`. A failed session list sentence (`workouts-error` / `create-error`) uses that same computed color. A staff mark that is an icon, not a sentence, stays `rgb(226, 59, 59)`: the unsuspended lock icon in `frontend/src/components/admin/users-tab.tsx`. Do not edit that file to make the test pass.

### 13. A-09 and B-1 — Member glyphs replace Placeholder and the template logo

**Files.** `frontend/app/auth.tsx` (the `icon.png` image and the Placeholder text, lines 49–56). `frontend/src/components/night/coach-mark.tsx` (`CoachMark`, `PosterPlate`, `posterPlaceholder`). New `frontend/src/components/night/plate-glyphs.tsx`. `PosterPlate` is called from `workouts.tsx` with `name` only; pass `equipment` from the library row. `design_guidelines.json`: delete the auth-hero sentence that says the icon is "marked Placeholder", and delete the three `images.pexels.com` / `images.unsplash.com` URLs. No other guidelines edit.

**Fix.** Copy the path data from `docs/release/bot-b/art/` into the member module and render with `react-native-svg` (`react-native-svg` is already a dependency). Do not import the SVG files from `docs/`. Stroke is `colors.text` at 2.25 on a `0 0 64 64` viewBox, round caps, no fill. Chartreuse stays off the artwork. `IronflowMark` is the two rounded rects and the bar from `mark.svg`. Equipment glyphs: barbell, dumbbell, kettlebell, machine, bodyweight. A `switch` on that union ends in a `never` check. Unknown equipment, including a missing value, draws a neutral rounded plate written in the same stroke. It does not draw the barbell. Bot B's sketch defaulted unknown to barbell; D wins (see disagreements). Delete the Placeholder text node and the plate kicker. `CoachMark` draws `IronflowMark` inside the existing circle and stays decorative when the eyebrow already says Coach. Library compact tiles (84×72, `surface3`) show one equipment glyph and no caption; the exercise name beside the tile stays. Do not rasterize `mark.svg` into `icon.png`, `adaptive-icon.png`, `splash-image.png`, or `favicon.png`. `frontend/app.config.js` spreads the member Expo config and only overrides the name and the router root, so a new shared favicon would become the staff favicon. Staff sign-in keeps the chevron in `frontend/staff/auth.tsx`. Do not ship `portrait-coach.svg`. The demo-stage movement plate is B-3 and stays deferred. Body glyphs in the art folder are for that later pass; do not mount them on Home or on the coach circle in this change.

**Test.** Signed-out `/auth` and the library tab: `getByText("Placeholder")` count is 0, and the exercise name is still visible. Auth, the coach circle, and a library row do not show the Expo mark. An exercise whose equipment is outside the five keys does not render the barbell glyph. A staff page still shows the staff chevron (`M14 50 L28 18` in `staff/auth.tsx`), not the member monogram. `design_guidelines.json` no longer contains `images.pexels.com` or `images.unsplash.com`. A search under `frontend/` still finds no remote stock URL.

### 14. B-2 — Wordmark and a form that sits under the mark

**Files.** `styles.brand` and `styles.form` in `frontend/app/auth.tsx`. Do this in the same auth edit as items 11–13. Do not change `maxWidth: 1120` in `frontend/app/_layout.tsx`.

**Fix.** Wordmark: `fontFamily: fonts.displayStrong`, `fontWeight: "400"`, `fontSize: 40`, `letterSpacing: 0.2`, so the Bold file is not faux-bolded. Above 480px the form column is `width: "100%"`, `maxWidth: 420`, `alignSelf: "center"`. At 390 the email field sits below the mark, not on top of it (today the field overlaps the hero). Staff sign-in is a different component and stays.

**Test.** At 1440, `input-email` width is at most 420 and it does not overlap the mark. Computed `font-family` on IRONFLOW includes `IronflowDisplayStrong`. At 390 the field sits below the mark. Home's stage at 1440 is still the 660-wide stage (do not assert a narrower Home).

### 15. A-10 — The checked language is the language on screen

**Files.** `frontend/app/settings.tsx`. The chip uses `user?.preferred_locale ?? "fr"` (line 353). `I18nProvider` uses `user?.preferred_locale ?? initialLocale` (`frontend/src/i18n.tsx`). `selectLanguage` returns early only when `locale === user?.preferred_locale`, so a missing preference still PATCHes. `useI18n()` already exposes `locale`.

**Fix.** Selected chip is `user?.preferred_locale ?? locale` from `useI18n()`. `selectLanguage` returns early when the tapped code equals that running locale, so tapping the checked language sends no PATCH. Set `aria-checked={active}` on the chip. Keep `accessibilityState` for native. Do not restyle fill or border. D narrowed the "not visually distinct" claim: the checkmark and the text color already differ. The defect is the wrong language and the missing `aria-checked`.

**Test.** Browser `en-US`, profile without `preferred_locale`: English is checked, `language-en` has `aria-checked="true"`, and clicking it sends no PATCH. A profile with `preferred_locale: "fr"` checks French and the UI strings are French.

### 16. A-12 — Session rows have an accessible name

**Files.** The session `Pressable` in `frontend/app/(tabs)/workouts.tsx` (`testID={`workout-${item.id}`}`, about lines 243–252). It has no `accessibilityRole`.

**Fix.** `accessibilityRole="button"` and `accessibilityLabel` built from `item.title` and `sessionMeta(item)`. That label uses the A-05 duration rule, so an unknown length is not announced as "0 min".

**Test.** `workout-w-live` accessible name matches `/Push day/i` and `/in progress/i`.

### 17. A-13 — New session resumes the open lift, and does not swallow a run

**Files.** `createDated` / `openNewSession` / `fab-new-workout` in the same file. A row press already does `router.push(/record/${id})` when `item.activity` is an object (lines 247–250). The empty-state button `empty-new-session` only renders when the list is empty; leave it creating a session.

**Fix.** Use the open-session helper from item 5. One open lift with no `ended_at`: the filled `fab-new-workout` navigates to that id and does not POST `/workouts`. Keep a second action that creates another session after a confirm. A list of only finished workouts still creates. An open row with `activity` set resumes `/record/{id}`, or asks, and does not open `/workout/`. Two open rows: the sheet names each title and does not `find` the first. The library path that already opens the plan modal when slugs are selected stays.

**Test.** One open lift: `fab-new-workout` navigates to that id and `POST /workouts` is not called. A list of only finished workouts still creates. An open row with `activity` set does not open `/workout/`.

### 18. D-03 — Web checked and expanded state

**Files.** `aria-checked` on the language chips (item 15) and on the auth role chips (item 11). `aria-expanded={navOpen}` on `admin-nav-menu` in `frontend/staff/index.tsx` (line 127), beside the existing `accessibilityState={{ expanded: navOpen }}`. No staff layout, token, or copy change.

**Fix.** Any control whose web test needs checked, selected, or expanded state sets the `aria-*` prop. Setting `accessibilityState` alone does not expose it on this build.

**Test.** `language-en` exposes `aria-checked`. `admin-nav-menu` exposes `aria-expanded` after the fix (`true` while the drawer is open, `false` while it is closed).

### 19. Staff menu helper — stop the second click

**Files.** `frontend/e2e/staff-nav.ts` only. This is the root cause of the historical red mobile runs.

**What happened.** On `9604bac`, Chromium at 390×844 does open the drawer on one click and on one tap. The name changes from Menu to Close menu, and `admin-tab-users` is in the layout. The helper clicks Menu, waits 8 seconds, and if the tab is still hidden it clicks again whenever `aria-expanded !== "true"`. That attribute is never set today, including while the drawer is open. A slow first paint therefore gets a second click that closes the drawer, and the test times out. A warm re-run passes. Classification: flaky test helper. Not a stuck menu, and not "the machine cannot click."

**Fix.** After the first click, if the tab is still hidden, click again only when the control's accessible name is still Menu (the drawer is still closed). If the name is already Close menu, wait for the tab and do not click. Do not use `aria-expanded` as the open signal. Adding the attribute in item 18 does not by itself make this helper safe. Do not change staff layout to chase the flake.

**Test.** On the mobile project, one Menu open finds `admin-tab-users` visible and does not click Menu a second time. The three historical cases pass without a retry: "moderator resolves a report and must give a reason to suspend", "audit tab shows who did what", and "support queue can hide assigned tickets".

## Documented disagreements

D's severity stands in every case. These are the only places the fix is narrower than the original proposal, and why.

1. **Unknown equipment (B-1).** Bot B's sketch returns `"barbell"` for any equipment outside the five keys. D says that labels the wrong implement. This plan uses a neutral plate. D wins.

2. **Shared favicon (B-1).** Bot B rasterizes `mark.svg` into the member icon, splash, and favicon. D confirms the drawing and warns that `app.config.js` shares that favicon with staff. This release also forbids changing the staff favicon. In-app member marks ship. The installed icon and the shared favicon stay until a later change gives staff its own favicon. `frontend/staff/auth.tsx` is not edited.

3. **B-10 stays P3, with one deletion inside B-1.** D's severity is P3: the stock URLs are a documentation trap, not a network call, so a guidelines rewrite is deferred. D's B-1 fix concern says to delete those URLs and the Placeholder sentence in the same change, so a later pass does not wire them. That deletion is part of item 13. Nothing else in `design_guidelines.json` changes.

4. **A-08 does not throw on every empty 2xx.** D wants a non-object 2xx to throw a short sentence so login cannot call `setToken` on `null`. A throw for every null 2xx would break legitimate empty 204 responses (notification delete, channel typing, community onboarding, and the other 204 routes). The throw is for a non-empty 2xx that is not JSON. `login` and `register` still refuse `setToken` unless `access_token` is a string. Severity stays P2.

A-14 stays P3 even though it shares `session-summary` with D-01. D-01 does not pluralize "1 sets".

## Order, in one pass per file

1. `workout/[id].tsx`: A-03, A-02, A-01, D-01.
2. `open-session.ts` plus Home and Plan: A-04, then A-07 in `program.tsx`.
3. `workouts.tsx`: A-05, then A-12, A-13, the B-6 sentence, and the B-1 `equipment` prop.
4. `server.py` and `test_analytics.py`: D-02.
5. `checkin.tsx`: A-06.
6. `api.ts` and `auth-context.tsx`: A-08.
7. `auth.tsx`, `coach-mark.tsx`, `plate-glyphs.tsx`, and the two guidelines deletions: A-11, B-6, A-09, B-1, B-2.
8. `settings.tsx`: A-10 and `aria-checked`.
9. `staff/index.tsx`: `aria-expanded`.
10. `staff-nav.ts`: the helper, then the mobile admin tests.
