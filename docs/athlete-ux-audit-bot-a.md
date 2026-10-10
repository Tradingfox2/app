# Athlete UX audit — Bot A

Independent product and UX audit of the IronFlow athlete app as it stands on `design/ironflow-athlete-experience` at `b4764b8` (“Redesign the athlete app around honest metrics and IronFlow Motion.”).

This pass does not treat `docs/athlete-app-audit.md`, `docs/athlete-redesign-report.md`, or `docs/athlete-design-system.md` as the verdict. Those documents describe the first redesign. This one judges the app that redesign produced.

**Out of scope:** `frontend/staff/**` and `frontend/src/components/admin/**`.

**No app code was changed.**

## How this was judged

- Source read for navigation, Home, Workouts, the live logger, Programs, anatomy entry, Community, Profile, Settings, Sources, Labs, Activity, Analysis, Morning, and the shared metric, ring, and image pieces.
- Backend `POST /programs/{id}/start-day` and `GET /home/today` were read only where a frontend claim depended on them.
- Playwright (Chromium) rendered the member web app on port 8082 with a synthetic signed-in athlete and mocked `/api` responses. Viewports: **1440×900, 1280×800, 768×1024, 390×844**. Shots are JPEGs under `docs/athlete-ux-audit/`. Layout numbers below (widths, y positions, control heights, computed backgrounds) come from those renders, not from a design guess.
- Native iOS and Android were not launched. Keyboard, camera check-in, GPS recording, and a process restart were not exercised.

**Verified bug** means the behavior is in the source, or it was visible in the rendered DOM. **UX hypothesis** means the interface is functioning as written and the problem is a product judgment.

## Verdict on the first redesign

The direction is the right one for this product. Home now leads with the session. Missing wearables render as an em dash with “Not connected,” not as a fake zero. Readiness says it is training guidance, not a medical assessment. Sources and Activity can say “Sample data.” Trends say a gap is not a zero. Labs open with an educational banner. The Workout tab is a barbell, not a plus. Logger inputs are 56px tall and the entry bar is hidden after finish. Chartreuse is reserved for the primary action.

That pass solved the “what do I do today?” problem and the “zero means broken sensor” problem. It did not finish the job. The same home still offers a second session while one is live, starts a program day on a path that always inserts a new workout, and labels simulated numbers “Measured.” On a laptop the phone layout stretches to the edges of the window. Performance tools live in a long Home scroll and are absent from You and Settings. Several failures still look like empty states.

## What transfers from other products

Research used public product writing and critiques, not a live login to those apps: WHOOP’s 2025 Home note and brand color rules, WHOOP onboarding work on calibration, Nike Training Club critiques (Pratt IXD, ScreensDesign, Delange), Strava feed and recording critiques (Pratt IXD, Folenta), Garmin Connect critiques (Ventura, Garmin forums, Gneta), Apple Human Interface Guidelines (buttons, layout, charts, accessibility), and Material Design 3 (navigation bar, 48dp targets, hierarchy).

| Source | Transfer to IronFlow | Leave behind |
|---|---|---|
| **WHOOP** | One morning question, answered before the charts. Dark ground so the numbers stay quiet at 6am. Unknown and “still calibrating” must be named, or people think the app is broken. A tap on a score should open the trend. | Three dials as the whole home. WHOOP’s job is the band. IronFlow’s job is the session. Green / yellow / red recovery reads as a medical grade; IronFlow already refuses that, and should keep refusing it. Do not rename IronFlow metrics to Strain or Recovery just because a wearable uses those words. |
| **Nike Training Club** | A plan has one front door. Duration, equipment, and level are visible before the athlete commits. Progress is a count of sessions done, not a second dashboard. One back control, in the same place, on every pushed screen. | Full-bleed trainer photography and a video class player. This repo has no licensed photo set. A fake photo library would make the logger and the labs look like a different product. |
| **Strava** | One obvious way to start the thing the app is for. Finish is a real state, with a summary, and Done returns to a predictable place. The activity page should answer “what did I just do?” | A center Record button. Strava’s primary act is GPS. IronFlow’s primary act is the planned lift. A record button in the tab bar would steal the thumb from Start day. Home as a social feed is also the wrong model: IronFlow already has a Community tab for that. |
| **Garmin Connect** | A number without a sentence fails. Athletes search the web for HRV, readiness, and load. Keep the sentence next to the score. Do not split “how should I train?” across three menus. | One chart per metric, nested by data type. Color bars whose meaning has to be memorized (Garmin’s training-status palette is a known complaint). More charts on Home. |
| **Apple HIG** | One filled primary button per view. Hit targets at least 44×44 pt. Labels that match the visible action. Charts that expose the value and the date to VoiceOver, not only the color. Enough margin that controls are not mistaken for each other. | iOS navigation chrome, large titles, and SF symbols as the visual system. IronFlow already has its own type and ground. Dynamic Type is a later native pass, not a web restyle. |
| **Material 3** | Three to five equal destinations. IronFlow’s four tabs (Home, Workout, Community, You) fit. Touch targets of 48dp where the thumb is the pointer. Important actions at the top or the bottom, not buried in a paragraph. Empty states that explain the situation and offer the next action. On a wide window, a navigation rail instead of a bottom bar stretched across a monitor. | A second visual language (tonal surfaces, M3 color roles) on top of IronFlow Motion. Staff already has its own system. The member app should not grow a third. |

## Journeys

### 1. Open the app and train the planned day

1. Signed-in athletes land on Home (`frontend/app/index.tsx`).
2. The first card is **TODAY'S SESSION** with **START DAY** (`frontend/app/(tabs)/home.tsx`).
3. That button calls `api.startProgramDay` and opens `/workout/[id]`. It does not look for an open session.
4. The logger shows the planned exercise, reps / kg / RPE, and **Add set**.
5. **FINISH** flushes the offline queue, then the share sheet. **DONE** calls `router.back()`.

Friction: a second **START EMPTY** sits under the primary. If a session is already open, Home still shows **START EMPTY**, and **START DAY** still creates another workout.

### 2. Resume

1. Home shows the open title and **RESUME SESSION** when `active_workout` is set.
2. The Workout tab lists the same session as “in progress.”
3. Both open `/workout/[id]`.

Friction: with a plan still waiting, Resume and Start empty are on the same card.

### 3. Build a session from the library

1. Workout tab, **LIBRARY**, search and chips, select exercises.
2. The full-width **NEW SESSION** button opens a title sheet when something is selected, and creates a dated session when nothing is.
3. The logger then says **NO PLAN YET** until exercises are added, or shows the selection.

Friction: the screen title stays **Sessions** on the library. The selected segment uses the same fill as the track.

### 4. Generate a plan and start day 1

1. Home **GENERATE PLAN** or **TRAINING PLAN** opens `/program`.
2. Goal, level, days, and equipment, then **GENERATE 4-WEEK PROGRAM**.
3. Week chips, day cards, **START DAY**.
4. If a session is already open, Program asks **ADD TO OPEN SESSION** or **NEW SESSION**. Home’s start button does not.

### 5. Connect a wearable and trust the number

1. Home **Connect a wearable** or **SOURCES** opens `/sources`.
2. A simulated source is labeled **SAMPLE DATA** and “Sample data. This is not a live reading.”
3. Activity repeats **Sample data** on steps and calories when the row is simulated.
4. Home rings do not. A nonzero value is captioned **Measured**.

### 6. Read a lab and a trend

1. **LABS** and **TRENDS** are quick actions on Home, below the week card.
2. Labs leads with the educational line. A failed load looks like “upload a panel.”
3. Trends states that a gap is not a zero. The screen is not linked from You or Settings.

### 7. Find people, then find messages

1. Community tab. Title, four icon tools, a marketing band, optional live strip, then five tabs, then the feed.
2. Messages is the first icon, and also a Home header icon. The tab badge counts DMs, not feed activity.

### 8. You, settings, and everything else

1. You is the profile wall: edit, saved posts, friends, then posts.
2. The gear opens Settings: identity, sign out, coach, notifications, language, privacy, billing.
3. Plan, labs, sources, trends, check-in, and outdoor record are not on either screen.

## Route by route

### Auth — `frontend/app/auth.tsx`

The gate is a normal email form. Role chips do not expose a selected state to assistive tech. Submit has no `accessibilityRole`. Rendered at 390×844 (`docs/athlete-ux-audit/auth-390x844.jpg`). Low severity. Not a blocker.

### Tabs — `frontend/app/(tabs)/_layout.tsx`

Four destinations, labeled, chartreuse when selected. Community’s badge is unread DMs. You’s badge is unread notifications. Home and Workout have no `tabBarButtonTestID`. On a 1440px window the bar still spans the viewport, because nothing constrains the column.

### Home — `frontend/app/(tabs)/home.tsx`

Rendered order, known data, 390×844: greeting and a wrapped header (session card starts at y=168, versus y=106 at 1440), then the session card (215px), readiness, then the rings. The rings card starts at y=626, so on an 844px phone the rings are only partly in the first screen. HRV is at y=1305. Training plan quick actions are at y=1061. That is the right priority: session, then readiness, then rings. It is also a long page.

At 1440×900 the session card is **1408px wide**. The primary button is 1374×52. The layout is a phone screen pulled sideways.

Unknown payload (`home-unknown-*.jpg`): readiness is **—** and “Unknown. Not enough measured inputs…”. Recovery and sleep say **Not connected**. The first ring is **LOAD / Not measured**, not strain, because `showSessionLoad` is true whenever `strain` is null.

Live payload (`home-live-*.jpg`): a **LIVE** card sits between the session and readiness (strip y=333, readiness y=467 at 1440).

Active payload (`home-active-*.jpg`): the card reads **RESUME SESSION** and **START EMPTY** together.

### Workouts and library — `frontend/app/(tabs)/workouts.tsx`

Sessions list, in-progress copy, and a full-width **NEW SESSION** bar above the tab bar. Library search and filters work. The selected segment’s computed background equals the track (`rgb(36, 42, 49)` on both). Chips measure **36px** tall (`chip-all` on the library). The title stays **Sessions** after switching to Library.

### Live logger — `frontend/app/workout/[id].tsx`

After the workout document loads, the 390px logger shows **LIVE SESSION**, the title, **FINISH**, **PLANNED · 1**, Bench Press, an empty set list, and a bottom bar of REPS / KG / RPE plus add. Inputs are 56px tall. At 1440 the reps field is **444px wide**. Empty reps or a non-numeric weight make **Add set** return without a message (`quickAddSet`). Finish stays closed while sets are unsynced, and the offline banner has no retry control of its own.

### Program — `frontend/app/program.tsx`

With an active plan, the screen shows week 1, **ADJUST TODAY'S SESSION**, and day cards with **START DAY**. The refresh control is an unlabeled icon. It only clears React state. A failed `api.programs()` falls through to the generator. After a successful adjust, the adjusted day is rendered in addition to the week’s original day.

### Muscles — `frontend/app/muscles.tsx`

Reachable from Program and from the logger’s **Add from muscles**. This screen is one of the few that checks `router.canGoBack()` before calling `back()`.

### Activity — `frontend/app/activity.tsx`

Day strip, training minutes, and wearable figures. A simulated row renders **Sample data** (confirmed in the DOM for the 10 Oct 2026 fixture: steps and calories). This is the honest pattern Home does not use. Back falls back to Home when there is no history.

### Analysis — `frontend/app/analysis.tsx`

**Trends**, the gap sentence, 30 / 90 day tabs, and one card per series. The 30-day tab uses chartreuse with dark text, which is the correct primary pairing. Retry is a text link. Cold entry uses `router.back()` with no fallback.

### Labs — `frontend/app/labs.tsx`

**Blood panels** plus the educational banner, visible at 390 and 1440. Upload actions have no `accessibilityRole`. A thrown load is swallowed and the empty upload paragraph remains.

### Sources — `frontend/app/sources.tsx`

Whoop can read **LIVE**. Garmin in simulated mode reads **SAMPLE DATA** and “Sample data. This is not a live reading.” Confirmed at 390 and 1440. A failed first fetch leaves the previous list, which on a first visit is nothing, with no error. Primary buttons are `minHeight: 42`.

### Morning — `frontend/app/morning.tsx`

Sleep, soreness, and mood. Shown from Home only when readiness confidence is below 0.5. Skip and save call `router.back()`.

### Community — `frontend/app/(tabs)/community.tsx`

On 390 the feed container starts at y=358, so the composer is on the first screen, under the title, four icons, and the “Find your people” band. With a live session the feed starts at y=492. An athlete with no club sees **FIND A CLUB**, which matches the empty state. An athlete who already has a club gets **BECOME A COACH** as the only brand button (`community.tsx` around the `clubFirst` branch). Five section tabs sit in a horizontal scroller.

### Profile — `frontend/app/(tabs)/profile.tsx` and `profile-wall.tsx`

You is a social wall. Shortcuts are edit, saved posts, and friends. The gear is the only door to account settings. No plan, labs, sources, or trends.

### Settings — `frontend/app/settings.tsx`

The first screen is the name, three shortcuts that repeat Profile, and **SIGN OUT**, then coach, requests, and notifications. A second sign-out control exists lower in the file (`logout-btn-bottom`). There is no performance section.

## What is working and should stay

- Session before rings. Confirmed at all four viewports.
- Unknown readiness and missing wearables use **—**, not 0. Confirmed on `home-unknown-*.jpg`.
- The readiness sentence includes “Not a medical assessment.”
- Sources and Activity label simulated rows. Trends label gaps. Labs label education.
- Chartreuse is the filled primary (start, new session, add set, find a club), not the ground.
- Logger plan chip, 56px inputs, and the post-finish removal of the entry bar match the redesign’s logger claims.
- `frontend/src/metric-state.ts` still distinguishes a missing point from a numeric zero. The bug below is that Home never passes `simulated` into that reader.

## Findings

### UX-01 — Home can open a second workout while one is live

| | |
|---|---|
| Kind | Verified bug |
| Severity | High |
| Confidence | High |
| Evidence | `startEmpty` in `frontend/app/(tabs)/home.tsx` has no `activeWorkout` guard. The card renders **START EMPTY** under **RESUME SESSION** when both `active_workout` and `next_session` are set (lines 393–449). Rendered text at 390 and 1440: “RESUME SESSION” and “START EMPTY” (`docs/athlete-ux-audit/home-active-390x844.jpg`, `home-active-1440x900.jpg`). `startEmpty` calls `api.createWorkout`. |
| Impact | Two open sessions. Home’s “the” session becomes ambiguous. Sets land in whichever workout was opened last. |
| Recommendation | While `active_workout` is set, the only primary action is Resume. Move ad-hoc logging to the Workout tab. |
| Acceptance | With `active_workout` on `GET /home/today`, the Home card does not call `createWorkout`. One chartreuse button: Resume. |
| Regression | Fixture `active_workout` plus `next_session`. Assert `today-start-empty` is absent. Assert `start-workout-cta` navigates to that workout id. |

### UX-02 — Home “START DAY” always inserts a new workout

| | |
|---|---|
| Kind | Verified bug |
| Severity | High |
| Confidence | High |
| Evidence | Home `startDay` (`home.tsx` 271–281) calls `api.startProgramDay` immediately. Program `startDay` (`frontend/app/program.tsx` 221–250) loads workouts, and if one has no `ended_at` it opens `merge-session-sheet` (`merge-into-open`, `merge-new-session`). Backend `start_program_day` (`backend/routers/program.py` 448–505) always `insert_one`s a workout with `ended_at: None`. |
| Impact | The same words, **START DAY**, do different things on Home and on the plan. Home can stack a second open program session on top of an empty or in-progress one. Program’s merge sheet is the behavior athletes already have, and Home bypasses it. |
| Recommendation | Use one helper for “start this program day.” Home and Program both offer add-to-open or new session. |
| Acceptance | With an open workout, Home `today-start-day` shows `merge-session-sheet` and does not call `startProgramDay` until the athlete picks **NEW SESSION**. **ADD TO OPEN SESSION** opens the existing id. |
| Regression | Open workout fixture, tap `today-start-day`, expect the merge sheet and no second create. Repeat from `start-day-1` on Program and expect the same sheet. |

### UX-03 — Home calls a simulated number “Measured”

| | |
|---|---|
| Kind | Verified bug |
| Severity | High |
| Confidence | High |
| Evidence | `metricCaption` (`frontend/src/metric-state.ts` 53–56) returns `measured` for any nonzero number. Home rings use that caption and `wearable_connected` only (`home.tsx` 255–256, 533–549). `clean()` on `GET /home/today` (`backend/server.py` 73–78, 1252–1258) returns the metric document, and demo sync writes `simulated: true` (`backend/routers/wearables.py`). Activity does read the flag (`frontend/app/activity.tsx` 187–205) and the rendered day shows **Sample data**. Sources shows **SAMPLE DATA** (`docs/athlete-ux-audit/sources-390x844.jpg`). The design system says sample data is never labeled live. |
| Impact | A demo or sample recovery of 80% looks like a real morning. The redesign fixed null-versus-zero and left sample-versus-live on the screen athletes see first. |
| Recommendation | If the point’s `simulated` flag is true, caption the ring **Sample data** and keep the figure. Do not relabel it Measured. |
| Acceptance | Home fixture with `recovery: { value: 80, simulated: true }` shows 80 and a sample caption on `ring-recovery`. A non-simulated 80 still says Measured. A null recovery still says Not connected or Not measured. |
| Regression | Extend the unknown-versus-zero Home spec with a simulated-recovery case. Assert the sample string and assert Activity’s existing sample line still appears. |

### UX-04 — Add set fails in silence

| | |
|---|---|
| Kind | Verified bug |
| Severity | High |
| Confidence | High |
| Evidence | `quickAddSet` in `frontend/app/workout/[id].tsx` (359–364): `if (!r || Number.isNaN(w)) return;` with no error state. The button itself is correct (`add-set-btn`, 56px inputs, rendered on `logger-390x844.jpg` and `logger-1440x900.jpg`). |
| Impact | A cleared reps field or a half-typed weight looks like a dead button during a set. This is the highest-frequency control in the app. |
| Recommendation | Keep the row local only when reps and weight parse. Otherwise set an inline message on the entry bar and do not start the rest timer. |
| Acceptance | Empty `input-reps` plus `add-set-btn` shows a validation message, adds no set, and does not show `rest-timer`. A valid pair still appends a row and shows Saving. |
| Regression | Playwright on `/workout/w-1`: clear reps, tap add, expect the message test id. Then enter 5 and 60 and expect a set row. |

### UX-05 — The plan screen can pretend the plan vanished

| | |
|---|---|
| Kind | Verified bug |
| Severity | High |
| Confidence | High |
| Evidence | `regenerate-btn` (`frontend/app/program.tsx` 300–306) sets `program` and `programDoc` to null and does not call the API. The control is an icon with no accessible name (rendered at the top of `program-390x844.jpg` and `program-1440x900.jpg`). `load` (156–172) treats every throw as “no program yet,” and the generator replaces the plan UI (330–331). |
| Impact | A tap on refresh looks like the block was deleted. Leaving and returning brings it back, which feels like a glitch. A network error on open shows the first-run generator, so an athlete can generate a second block thinking they had none. |
| Recommendation | Name the control **New plan** only if it is a confirmed replace. A failed load shows an alert and retry, not the generator. |
| Acceptance | `regenerate-btn` does not hide the loaded plan without a confirm. `GET /programs` 500 shows `program-load-error` and `program-load-retry`, and does not show `generate-btn` as the only content. |
| Regression | Two Playwright cases: loaded plan, tap regenerate, assert day cards remain until confirm; mocked 500, assert the error test id. |

### UX-06 — Laptop and tablet widths stretch the phone column

| | |
|---|---|
| Kind | Verified bug |
| Severity | High |
| Confidence | High |
| Evidence | No member screen sets a content `maxWidth`. At 1440×900 the Home session card measures **1408×215** and the start button **1374×52** (`home-1440x900.jpg`). The logger reps field measures **444px** wide (`logger-1440x900.jpg`). The same pattern is on 1280×800. Material’s navigation bar is for compact and medium windows; a wide window wants a rail or a centered column. Apple’s layout guidance is to keep text to a readable measure. |
| Impact | The session hero, which is the redesign’s main idea, becomes a banner. Numeric entry fields become strips. The bottom bar’s four items sit far apart. The product feels unfinished on the web build athletes and coaches will open on a computer. |
| Recommendation | Center the member column at about 480px from 768px upward, or use two columns only when a screen is actually a board (plan week beside the day). Keep the bottom bar inside that column. Do not add a desktop information architecture in this pass. |
| Acceptance | At 1440×900, `today-card` width is at most 560px and is centered. `input-reps` is at most 160px. At 390×844 the card still uses the screen width minus the page padding. |
| Regression | Playwright box check on `today-card` and `input-reps` at 1440 and 390. |

### UX-07 — Strain disappears when it is missing, and HRV sits a screen below

| | |
|---|---|
| Kind | Verified bug for the ring swap. UX hypothesis for how far HRV should move. |
| Severity | Medium |
| Confidence | High |
| Evidence | `showSessionLoad = data?.strain == null` (`home.tsx` 245). Unknown render text: “NO WEARABLE DATA”, then “LOAD / Not measured”, while recovery and sleep say “Not connected” (`home-unknown-390x844.jpg`, `home-unknown-1440x900.jpg`). HRV’s card is at y=1305 on a 390×844 screen and y=1223 on a 1440×900 screen, after quick actions. |
| Impact | The athlete who has no wearable sees a different first ring than the athlete who has one. “Not measured” on load and “Not connected” on recovery answer two different questions in one row. HRV, which readiness lists as a missing input, is not next to readiness. |
| Recommendation | Keep three stable slots: strain or an explicit “Strain not connected,” recovery, sleep. Put HRV and resting HR in that same card. Session load can stay in the week card, where the training totals already live. |
| Acceptance | A null strain with `wearable_connected: false` still shows a strain label and “Not connected,” and does not show a LOAD ring in that slot. `metric-hrv` and `ring-recovery` share a parent region that starts within 400px of `readiness-card`. |
| Regression | Unknown fixture: `ring-strain` or an equivalent test id is present; `ring-load` is absent. Box assertion for HRV versus the rings card. |

### UX-08 — Two start actions on the planned day

| | |
|---|---|
| Kind | UX hypothesis, with the rendered control confirmed |
| Severity | Medium |
| Confidence | High |
| Evidence | When there is a next session and no active workout, Home shows **START DAY** and **START EMPTY** (`home.tsx` 404–438). Rendered at every viewport, including `home-390x844.jpg` and `home-1440x900.jpg`. The empty action is a text button, not a second filled button, but it is always in the hero. |
| Impact | The hero was supposed to answer “do today’s plan.” The second action invites a blank session that will not carry the day’s exercises. Athletes who meant to start the plan can open an empty log instead. |
| Recommendation | One filled action in the hero. Ad-hoc sessions stay on the Workout tab, which already has **NEW SESSION**. |
| Acceptance | A home fixture with `next_session` and no `active_workout` shows `today-start-day` and does not show `today-start-empty` in the hero. `fab-new-workout` still creates a session. |
| Regression | Playwright visibility assertion on those two test ids. |

### UX-09 — Plan, labs, sources, and trends are a Home scavenger hunt

| | |
|---|---|
| Kind | UX hypothesis backed by rendered information architecture |
| Severity | Medium |
| Confidence | High |
| Evidence | Home quick actions (`home.tsx` 623–657) push `/program`, `/labs`, `/sources`, `/checkin`, `/analysis`, `/record`, and coach onboarding. They measure at y=1061 on a 390px Home (`quick-program`). Profile shortcuts (`frontend/src/components/social/profile-wall.tsx` 141–153) are edit, saved, friends. Settings sections (`frontend/app/settings.tsx`) cover coach, notifications, privacy, and billing. Rendered You (`profile-390x844.jpg`) and Settings (`settings-390x844.jpg`) match that. Garmin’s known failure is the same shape: the training decision is split across data-type menus. |
| Impact | An athlete who opens You to “see my stuff” finds posts. An athlete who finishes a session and looks for trends has to remember a row on Home. Labs and sources, which the redesign treated as trust surfaces, are easy to miss. |
| Recommendation | Add a **Training** group to Settings, or a short list under the You header: Training plan, Trends, Labs, Sources. Keep Home’s shortcuts as accelerators, not the only doors. |
| Acceptance | From `open-settings` or the You tab, one press reaches `program-screen`, `analysis-screen`, `labs-screen`, and `sources-screen`. |
| Regression | Playwright: Profile or Settings links with stable test ids, then assert each screen. |

### UX-10 — Failed labs and sources look like “you have nothing”

| | |
|---|---|
| Kind | Verified bug |
| Severity | Medium |
| Confidence | High |
| Evidence | Labs `load` returns `[]` on throw (`frontend/app/labs.tsx` 241–249) and the empty copy is the upload invitation (383–386). Sources `load` keeps the previous list and clears `loading` (`frontend/app/sources.tsx` 70–77) with no error and no pull to refresh. Program has the same shape (UX-05). |
| Impact | A down API looks like a brand-new athlete. People upload a second panel or reconnect a wearable that is already connected. |
| Recommendation | A distinct error with `accessibilityRole="alert"` and a retry. Empty copy only after a successful empty payload. |
| Acceptance | `labReports()` 500 does not show the upload-only paragraph. `wearableSources()` 500 shows a retry on first visit. |
| Regression | Mock 500 for each route. Assert `labs-load-error` and `sources-load-error` (new ids) and assert the happy empty copy is absent. |

### UX-11 — Recovery adjust can show two cards for one day

| | |
|---|---|
| Kind | Verified bug |
| Severity | Medium |
| Confidence | High |
| Evidence | `frontend/app/program.tsx` 481–497 renders `adjustResult.day` and then `week.days` without removing the matching `day_index`. Both cards call `startDay`. The button on the adjusted card and the original card share `testID={`start-day-${day.day_index}`}`. |
| Impact | After **ADJUST TODAY'S SESSION**, two **START DAY** buttons can exist for the same index. The athlete cannot tell which prescription will be logged. Duplicate test ids also make the e2e check ambiguous. |
| Recommendation | Replace the matching day in the list. One card, with the **ADJUSTED** badge. |
| Acceptance | After `adjusted: true`, there is one `day-card-{n}` and one `start-day-{n}`. |
| Regression | Mock `adjustProgram` and count those test ids. |

### UX-12 — “ADJUST TODAY’S SESSION” follows the selected week chip

| | |
|---|---|
| Kind | UX hypothesis |
| Severity | Medium |
| Confidence | Medium |
| Evidence | `adjustToday` calls `api.adjustProgram(programDoc.id, weekIdx)` (`program.tsx` 201–205, 448–461). `weekIdx` is the selected chip, initially the first week of the document (`load` sets `parsed.data.weeks[0]`). The rendered plan screen labels the button **ADJUST TODAY'S SESSION** next to **W1** (`program-390x844.jpg`). |
| Impact | Browsing a future week and tapping the button adjusts that week, while the label says today. |
| Recommendation | Either disable the button when the chip is not the current week, or rename it to the week it will change and show the target day in the result. |
| Acceptance | The visible label and the request’s week index refer to the same week. A non-current week cannot be adjusted by a control that says “today.” |
| Regression | Select week 4, tap `adjust-btn`, assert the request body week matches the spec you choose, and assert the label matches it. |

### UX-13 — Community spends the first screen on a pitch

| | |
|---|---|
| Kind | UX hypothesis |
| Severity | Medium |
| Confidence | High |
| Evidence | `frontend/app/(tabs)/community.tsx` 100–175: title, icon tools, signal band, live strip, five tabs, stories, scope chips, composer, then posts. Rendered feed y=358 at 390×844 without a live session, y=492 with one (`community-390x844.jpg`, `community-live-390x844.jpg`). An athlete who already has a club still gets **BECOME A COACH** as the brand action (lines 139–141). The tab badge is `dmUnread` (`_layout.tsx` 162–165). |
| Impact | The feed, which is why the tab exists, starts halfway down. Members are asked to become a coach. The badge promises community activity and delivers messages. |
| Recommendation | Keep messages as an icon with a count. Collapse the pitch once the athlete has a club, and make the brand action **Your club** or the feed. Say “unread messages” in the tab’s accessibility label. |
| Acceptance | With an active membership, `community-primary-cta` does not navigate to `/coach/onboarding`. On a 390×844 viewport the composer or the first post starts above y=280 when nothing is live. |
| Regression | Fixture `communities("mine")` with an active membership. Assert the CTA label and the feed’s y position. |

### UX-14 — Sign out sits above the account, and it sits there twice

| | |
|---|---|
| Kind | Verified bug for the duplicate. UX hypothesis for the placement. |
| Severity | Medium |
| Confidence | High |
| Evidence | `logout-btn` is in the Settings hero (`frontend/app/settings.tsx` 271–298). `logout-btn-bottom` repeats it (479). The rendered 390px Settings text begins “SETTINGS / Ada Lift / ATHLETE / EDIT PROFILE / VIEW PROFILE / FRIENDS / SIGN OUT” (`settings-390x844.jpg`). Profile already has edit and friends (`profile-wall.tsx`). |
| Impact | The destructive action is the first filled-looking control on the account screen. Two controls can drift. Edit and friends appear on both You and Settings. |
| Recommendation | One sign-out, at the end of Settings. Keep profile editing on You. |
| Acceptance | One control with accessibility label “Sign out.” It is below the privacy and billing sections. |
| Regression | `getByRole('button', { name: 'Sign out' })` resolves to one element on `settings-screen`. |

### UX-15 — Rings, quick actions, and the session list are poorly named

| | |
|---|---|
| Kind | Verified bug |
| Severity | Medium |
| Confidence | High |
| Evidence | Home `Ring` (`home.tsx` 47–75) puts `testID` on a `View` and does not set `accessibilityLabel`. Week cells do (around 876). `QuickAction` (936–957) has no role or label. Workout rows (`workouts.tsx` 239–257) have no label. The library FAB (`workouts.tsx` 409–421) has no label. Logger `finish-btn` and `back-btn` (`workout/[id].tsx` 502–515) rely on visible text or an icon. **GENERATE PLAN** is labeled “Open your training plan” (`home.tsx` 417–425). |
| Impact | The redesign’s captions (Not connected, Measured, Recorded zero) are visual only. VoiceOver on the main training actions is weaker than on the week calendar. |
| Recommendation | Name the ring with label, figure, unit, and caption. Name quick actions, session rows, the FAB, Finish, and Back. Make the generate button’s accessible name match **GENERATE PLAN**. |
| Acceptance | On the unknown fixture, `ring-recovery` exposes a name containing “Not connected.” `today-generate` exposes “Generate.” `fab-new-workout` exposes “NEW SESSION.” |
| Regression | Playwright `toHaveAccessibleName` on those ids. |

### UX-16 — Selected segments and filter chips are hard to see and small

| | |
|---|---|
| Kind | Verified bug |
| Severity | Low |
| Confidence | High |
| Evidence | `segBtnActive` uses `colors.surface2`, the same fill as the segment track (`workouts.tsx` 504–524). Computed style at 390 and 1440: button and track both `rgb(36, 42, 49)`. Selection is type weight and color. Library `chip` height is 36 (`workouts.tsx` 532–540); rendered `chip-all` is 36×49. Program chips use `minHeight: 40` (`program.tsx` styles). Apple’s minimum is 44pt. Material’s minimum is 48dp. |
| Impact | The Sessions / Library choice is a frequent switch and the selected half does not look selected. Filter chips miss taps. |
| Recommendation | Selected segment: contrasting fill or a 2px brand underline, plus `accessibilityState.selected`. Chips at least 44px tall. |
| Acceptance | Active and inactive segment backgrounds differ. `chip-all` box height is at least 44. The active chip sets `accessibilityState.selected`. |
| Regression | Computed-style or screenshot assertion on `tab-library-btn` after click, and a box check on `chip-all`. |

### UX-17 — Logger sync and finish recovery is a dead end

| | |
|---|---|
| Kind | UX hypothesis with the gate verified in source |
| Severity | Medium |
| Confidence | Medium |
| Evidence | `finish` (`workout/[id].tsx` 412–424) refuses to close while `pendingFor(id) > 0` and sets `finish-error`. The banner (`offline-banner`, around 584) reports the count. There is no button that calls `flushQueue` again. `setLoggerError` keeps only `notes[0]` (256) when several loads fail. Optimistic rows say Saving (`setSaving`, around 626) and have no failed state. |
| Impact | A stuck queue traps the athlete on the logger with a correct warning and no next step. A set that never leaves the device can read Saving indefinitely. |
| Recommendation | Put **Retry sync** on the banner. If a row fails, change Saving to a retry on that row. |
| Acceptance | With one queued set and a failing flush, the banner’s retry is enabled. A later successful flush allows `finish-btn` to reveal `share-panel`. |
| Regression | Queue one set, fail the first flush, succeed the second, assert the share panel. This can stay a unit test around the queue plus a logger UI test. |

### UX-18 — Copy and chrome do not match across stacks

| | |
|---|---|
| Kind | UX hypothesis, with the strings verified |
| Severity | Low |
| Confidence | High |
| Evidence | Home plan meta uses `t("{count} exercises")` even for one exercise (`home.tsx` 388). Rendered: “1 exercises.” Program’s title is **Plan** (`program.tsx` 298); Home’s shortcut is **TRAINING PLAN**. Analysis is **Trends**; Home’s row is **TRENDS**. Back icons alternate `chevron-back` and `arrow-back`. Morning, Analysis, and the logger use `router.back()` with no `canGoBack` fallback; Activity and Muscles have one. Field labels REPS / KG / RPE are not passed through `t()` (`workout/[id].tsx` 649–651). |
| Impact | The app feels assembled. A deep link to Morning or Trends can trap Back. Locales see English set-column headers. |
| Recommendation | One header component: 44px back, one icon, `canGoBack` or replace to Home. One name per destination. Pluralize the exercise count. Translate the logger columns. |
| Acceptance | `today-plan` for one exercise reads “1 exercise.” Logger column labels change with locale. Back from a cold `/morning` and `/analysis` reaches Home. |
| Regression | String assertion on the plan meta. A locale fixture for the logger labels. `page.goto` the two routes and press back. |

### UX-19 — Live sessions cut the line between the session and readiness

| | |
|---|---|
| Kind | UX hypothesis |
| Severity | Low |
| Confidence | High |
| Evidence | `LiveNowStrip` is mounted directly under the hero (`home.tsx` 459), before `readiness-card`. With a live fixture the strip is at y=333 and readiness at y=467 on 1440 (`home-live-1440x900.jpg`). The strip renders nothing when the list is empty, so the default home is unaffected. The redesign report’s order was session, readiness, rings. |
| Impact | On club workout days the morning decision is interrupted by a join card. The card is useful. It is in the wrong slot. |
| Recommendation | Keep the strip. Place it under the rings, or as a single line under the hero that does not push readiness down by a full card. |
| Acceptance | With a live session, `readiness-card`’s y is less than `live-now-strip`’s y, and `live-now-strip` is still present. |
| Regression | Live fixture. Compare the two boxes. |

### UX-20 — Weekly review and the morning check-in do not finish a loop

| | |
|---|---|
| Kind | UX hypothesis |
| Severity | Low |
| Confidence | Medium |
| Evidence | `weekly-review-card` (`home.tsx` around 582) is text, not a pressable. `showMorning` is `readiness.confidence < 0.5` (`home.tsx` 257–258). On the known render, readiness ends about 12px above the rings, so the morning row is absent. On the unknown render the gap is about 68px, which fits the morning row. There is no Profile or Settings entry to `/morning`. |
| Impact | A Sunday review cannot be acted on. An athlete who wants to log sleep when the score is already confident has no door. |
| Recommendation | The review card links to the plan or to trends. Morning stays available from the Training group in UX-09, even when the prompt is hidden. |
| Acceptance | The review card has one action. `/morning` is reachable from Settings without depending on confidence. |
| Regression | High-confidence fixture: `home-morning` is absent and the Settings link is present. Low-confidence fixture: `home-morning` is present. |

## Prioritized roadmap

Do these in order. Each wave is shippable on its own. None of them require new packages, photos, or a chart library.

### Wave 1 — One session, honest numbers

The athlete must not be able to create a second live workout by accident, and a sample number must not say Measured.

1. UX-01 and UX-02. Shared start-day flow. Resume is the only Home primary while a session is open.
2. UX-04. Inline validation on add set.
3. UX-03. Sample caption on Home rings.
4. UX-05 and UX-10. Errors are errors on Plan, Labs, and Sources.

Acceptance for the wave: the Home hero has one primary; sample recovery is labeled; a 500 on programs, labs, or sources shows retry; empty reps cannot add a set.

### Wave 2 — Make the web column fit a person

5. UX-06. Center the member column on wide windows. Do not redesign the screens inside it.
6. UX-07 and UX-08. Stable rings, HRV beside them, no second start in the hero.
7. UX-11 and UX-12. One day card after adjust. The adjust label matches the week.

Acceptance: 1440px screenshots show a column, not a banner. Unknown home still shows strain as unknown. Adjust produces one start button.

### Wave 3 — Put training where athletes look

8. UX-09. Training group on You or Settings.
9. UX-13 and UX-14. Community pitch collapses for members. One sign-out, at the bottom.
10. UX-19 and UX-20. Live strip and weekly review stop interrupting the morning decision, and both stay reachable.

Acceptance: Plan, Trends, Labs, and Sources are one press from You or Settings. Community’s brand button is not “become a coach” for someone who has a club.

### Wave 4 — Names, targets, and the same header

11. UX-15 and UX-16. Accessible names and 44px chips.
12. UX-17. Retry on the logger queue.
13. UX-18. Shared back header, plurals, translated set columns.

Acceptance: the unknown recovery ring has an accessible name; chips measure at least 44px; Back from a cold Trends URL reaches Home.

### Explicitly later

- Native keyboard, camera check-in, and GPS record on a device. Web screenshots cannot close this.
- Splitting `home.tsx` (about 1230 lines). Do it only when a wave already touches that file, and keep the test ids.
- Dynamic Type, a photo program browser, and a desktop nav rail with a second information architecture. The centered column is the web fix. A rail can follow if the column still feels like a phone floating on a monitor.

## Screenshot index

Synthetic athlete “Ada Lift.” Playwright, member web, mocked API. Files are under `docs/athlete-ux-audit/`.

| File | What it shows |
|---|---|
| `home-1440x900.jpg`, `home-1280x800.jpg`, `home-768x1024.jpg`, `home-390x844.jpg` | Session first, Start day and Start empty, stretched column on wide viewports |
| `home-scroll-1440x900.jpg`, `home-scroll-390x844.jpg` | Full Home scroll |
| `home-unknown-1440x900.jpg`, `home-unknown-390x844.jpg` | Dash readiness, Not connected, LOAD substituted for strain |
| `home-active-1440x900.jpg`, `home-active-390x844.jpg` | Resume and Start empty together |
| `home-live-1440x900.jpg`, `home-live-390x844.jpg` | Live card between the session and readiness |
| `workouts-*.jpg`, `library-*.jpg` | Sessions, library, segment, 36px chips, new-session bar |
| `logger-*.jpg` | Planned bench press, 56px inputs, wide inputs at 1440 |
| `community-*.jpg`, `community-live-390x844.jpg` | Pitch band, find-a-club, feed position |
| `profile-*.jpg` | You as a social wall |
| `program-1440x900.jpg`, `program-390x844.jpg` | Plan, unlabeled refresh, adjust, day cards |
| `labs-*.jpg` | Educational banner and empty upload |
| `sources-*.jpg` | Live Whoop, sample Garmin |
| `activity-*.jpg` | Sample data on steps and calories |
| `analysis-*.jpg` | Gap copy and 30 / 90 tabs |
| `settings-*.jpg` | Sign out in the hero |
| `morning-390x844.jpg`, `auth-390x844.jpg` | Check-in and the auth gate |

## Limits

- Fixtures, not a production account. Counts and names are synthetic.
- Web only. The logger’s keyboard behavior on iOS and Android is still untested.
- Clicks covered navigation and the library tab. Start day, merge, finish, upload, and OAuth were judged from source and from the backend insert, not from a completed network round trip.
- Staff console was not re-audited.
- The first redesign’s contrast tokens and font files were taken as given. This pass did not re-run the 23-pair contrast test.
