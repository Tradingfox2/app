# Athlete review — Bot D

Independent visual, accessibility, and regression review of `design/athlete-night-studio` (`7e93ee1`) against `design/ironflow-athlete-experience` (local commit `b4764b8`; that branch name is not on this remote) and against `main` (`7867a5e`).

The spec is `docs/athlete-design-spec-bot-b.md` (Night Studio). The prior audit is `docs/athlete-ux-audit-bot-a.md`. This pass did not treat a green typecheck as approval.

Fixes for the defects below are on `review/athlete-night-studio-fixes`, branched from `design/athlete-night-studio`.

## How this was judged

- Diff of Night Studio versus `b4764b8` (the athlete-experience redesign) and versus `main`.
- Source read for Home, the logger, library, trends, labs, sources, settings, coach copy, meters, charts, focus, and staff imports.
- Expo web: `EXPO_PUBLIC_SENTRY_DISABLED=1 npx expo start --web --port 8082` from `frontend/`. Chrome, signed-in synthetic athlete Ada Lift, mocked `/api`. Viewports **1440×900, 1280×800, 768×1024, 390×844**.
- Measurements (boxes, computed outline, meter track size) are in the notes taken during that pass, not guessed from the spec.
- **Native iOS and Android were not launched.** No simulator, no device, no hardware keyboard, no camera check-in, no GPS record, no safe-area inset on a real phone.
- **The backend was not started.** This environment has no `backend/.env` and no MongoDB. API contracts were checked through the mocked routes the member app already speaks, plus the source of the handlers the night-studio tests cover. A live `uvicorn` round trip was not run.

Screenshots in `docs/athlete-review-bot-d/`:

| File | What it shows |
|---|---|
| `before-home-390.png`, `before-home-1440.png` | Defects as shipped on `design/athlete-night-studio` |
| `before-focus-1440.png`, `before-library-390.png` | Focus and library before the fix |
| `after-home-390.png`, `after-home-768.png`, `after-home-1440.png` | Same screens after the fix |
| `after-focus-1440.png`, `after-library-390.png` | Focus ring and Play demo |
| `analysis-chart-390.png` | Trends chart with a gap |

## What already held

Checked on the rendered member app before any fix, and again after:

- Unknown readiness and missing wearables render **—** and “Not connected” / “Not measured”. A simulated strain of **0** renders **0** and **Sample data**, not Measured. A simulated recovery of **80** renders **80** and **Sample data**.
- An open workout’s only Home primary is **Resume session**. Start empty is not on that card.
- Empty reps do not add a set. The logger shows “Enter reps and weight before adding a set.” and does not start the rest timer.
- Labs keep the educational banner. Sources label Garmin sample copy as “Sample data. This is not a live reading.” and Whoop cloud as **LIVE**.
- Readiness still says the score is training guidance, not a medical assessment.
- `frontend/staff/**` and `frontend/src/components/admin/**` are unchanged versus `b4764b8`. They do not import `palette.ts`. Night Studio did not restyle the staff console.
- Reduced motion: with `prefers-reduced-motion: reduce`, the start control’s computed transition is `0s` and transform is `none`.
- No horizontal document overflow at the four viewports.

## Defects

Severity is the effect on a member using the screen, not the size of the diff.

### D1 — Meter fill does not show the number

| | |
|---|---|
| Severity | High |
| Where | `frontend/src/components/night/meter-row.tsx` |
| Repro | Open Home with recovery 80 and strain 14 at any of the four viewports. |
| Evidence | The track measured **2×52 px**. The fill was also **2×52 px**, because width was a percentage of a 2 px column and height was 100%. Strain and recovery looked the same: a hairline. Spec and `docs/design-refs/studio.css` are a horizontal track, **2 px tall**, fill by width. Before: `before-home-390.png`. |
| Acceptance | A recovery of 80 paints about 80% of a horizontal 2 px track. An unknown value paints no fill and shows **—**. The row’s accessible name still includes the label, the figure, and the caption. |

Fixed. After, at 1440, the recovery track is **133×2** and the fill is **106×2** (80%). See `after-home-390.png` and `after-home-1440.png`.

### D2 — Keyboard focus is a 1 px near-black line

| | |
|---|---|
| Severity | High |
| Where | `frontend/src/affordance.ts` (Home, tabs), `frontend/src/press-feedback.ts` (logger and plan), `frontend/src/press-affordance.tsx` |
| Repro | Tab to **Start day** on Home in Chrome. |
| Evidence | Computed outline before the fix: `rgb(15, 15, 15) auto 1px`, offset `0`. The ground is `rgb(16, 20, 24)`. Spec: 2 px `text` (`#F2F3F4`) outline, 2 px offset, including the brand button. `before-focus-1440.png`. |
| Acceptance | Focused **Start day** has a 2 px solid light outline and `outline-offset: 2px`. Chartreuse is not the focus color. |

Fixed. After, at 1440: `outline-width: 2px`, `outline-offset: 2px`, a light solid ring (`after-focus-1440.png`). Headless Chrome reported the color as about `rgb(229, 230, 231)` rather than the exact token `rgb(242, 243, 244)`. The ring is still the light text color, offset outside the fill. Hover on a primary moves the fill to `brandHover` (`#D9E567`) instead of a brightness filter.

### D3 — Missing coach tip invents green and red days

| | |
|---|---|
| Severity | High |
| Where | `frontend/app/(tabs)/home.tsx` fallback passed to `t()` |
| Repro | Load Home when `GET /coach/tip` fails. |
| Evidence | Visible sentence: “Recovery is your compass. Push hard on green days, glide on red ones.” The audit and the spec both refuse a green/red recovery grade. The sentence is not a returned tip. It is invented. |
| Acceptance | With no tip, the coach line does not mention green or red days. It stays training guidance, not a diagnosis. |

Fixed. The fallback is “Ask about today's session. Training guidance, not a diagnosis.” Translations are in `frontend/src/night-studio-locales.ts`.

### D4 — Stage title is not the spec face

| | |
|---|---|
| Severity | Medium |
| Where | `frontend/src/theme.ts` `type.stage` |
| Repro | Read the stage title on Home. |
| Evidence | Shipped type was Barlow Condensed SemiBold, 34/38, tracking 0. Spec: Barlow Condensed Bold, 40/40, tracking 0.2. The screen title is already 32, so the stage was only 2 px larger. |
| Acceptance | Stage title uses the Bold condensed file at 40/40 and tracking 0.2. Weight is not a synthesized stroke on top of that file. |

Fixed. `fontFamily` is `IronflowDisplayStrong` (the Bold file) at 40/40, tracking 0.2, `fontWeight: "400"` so the browser does not faux-bold the Bold cut.

### D5 — Wide Home is a phone column

| | |
|---|---|
| Severity | Medium |
| Where | `frontend/app/_layout.tsx`, `frontend/app/(tabs)/home.tsx` |
| Repro | Open Home at 1440×900 and 1280×800. |
| Evidence | Before, `home-screen` was **480×832** centered in the 1440 window (`before-home-1440.png`). Night Studio §7 and `docs/design-refs/home-desktop.html` put the stage on the left and readiness plus meters on the right. The earlier audit had asked for a 480 column; the night-studio spec replaces that for Home at desktop width. 768×1024 staying a column is correct. |
| Acceptance | At ≥1100 px, the stage and the readiness card sit side by side inside a column no wider than 1120. At 390, the stage still uses the screen width minus the page padding. At 768, the column stays ≤480. |

Fixed. At 1440, `home-screen` is **1120** wide, the stage is **660×420**, and readiness starts at x **865**, to the right of the stage (`after-home-1440.png`). At 390 the stage is **358** wide and starts at y **86** (it was y 168 when the week count wrapped the header). At 768 the column is still the centered phone width (`after-home-768.png`).

The training-week ledger stays full width under that split, not only in the right column. Phone order is unchanged: stage, coach, readiness, meters, review, week.

### D6 — “Placeholder” and the app icon sit on the stage

| | |
|---|---|
| Severity | Medium |
| Where | `frontend/src/components/night/coach-mark.tsx`, Home stage |
| Repro | Open Home. |
| Evidence | The stage’s first text was “Placeholder” under the app icon, and the coach row repeated it (`before-home-390.png`). Spec: if no local poster or coach photo exists, fill the stage with `brandWash` to the ground. Do not invent a person. The library may keep a named fallback inside the poster. |
| Acceptance | The stage has no app-icon badge and no “Placeholder” word. The coach row keeps a local mark because the eyebrow already says Coach. Library posters still say Placeholder inside the tile, at a readable size. |

Fixed for the stage and the coach caption. The library tile still says Placeholder, now 12 px inside the plate (`after-library-390.png`). There is still no commissioned photograph. The stage is a `brandWash` → `#101418` scrim, which is the spec’s no-photo fallback. The coach row still uses the existing app icon as a local mark, with empty alt because the eyebrow names the role.

### D7 — Copy still says “rings”

| | |
|---|---|
| Severity | Medium |
| Where | Home connect row, Sources intro |
| Repro | Disconnect wearables and read the connect row. Open Sources. |
| Evidence | “fill these rings” and “wearables feed the Home recovery rings” after the dials were replaced by meters. |
| Acceptance | Those sentences name strain, recovery, and sleep. They do not say rings. |

Fixed, including French, German, Spanish, and Italian in `night-studio-locales.ts`.

### D8 — Trend charts are silent

| | |
|---|---|
| Severity | Medium |
| Where | `frontend/src/components/line-chart.tsx`, `frontend/app/analysis.tsx` |
| Repro | Open Trends with a readiness series that includes a null day. |
| Evidence | The SVG had no accessible name. Stroke width was 3 px. Spec: 2 px `text` stroke, path breaks on a gap, and the chart exposes the same sentence a reader would need if the stroke disappeared. |
| Acceptance | The chart’s accessible name includes the series title, the plotted numbers, and the gap sentence when a point is null. Stroke width is 2. A null point does not draw the line through zero. |

Fixed. Rendered label: `Readiness: 60, 70, 80. A gap is a missing day, not a zero.` Role `img`. One polyline, `stroke-width` 2. The null day is not on that segment. Screenshot: `analysis-chart-390.png`.

### D9 — Week count is a second hero and wraps the phone header

| | |
|---|---|
| Severity | Medium |
| Where | `frontend/app/(tabs)/home.tsx` header |
| Repro | Open Home at 390×844. |
| Evidence | “THIS WEEK” was 9 px. The figure was 26 px at weight 800, which synthesizes a bold the numeric face does not have. The block wrapped under the name, so the stage started at y 168 instead of y 106. Spec: the week count sits in the ledger, not as a second hero. `streak-badge` must keep showing the workout count, including a real zero and an em dash while loading. |
| Acceptance | `streak-badge` is inside the training-week ledger. The figure uses Space Mono at weight 400. The stage on a 390 px screen starts near the header, not a wrapped second row. |

Fixed. The badge is in the week card. Stage y at 390 is **86**.

### D10 — Stage scrim sits on the wrong end

| | |
|---|---|
| Severity | Low |
| Where | Home `today-card` gradient |
| Repro | Inspect the stage fill. |
| Evidence | The wash ran from `brandWash` to transparent over the top 55%. The title sat on `surface`. Spec: type sits on the opaque ground end (`#101418`). |
| Acceptance | The stage fill ends on `#101418` under the title. |

Fixed. Computed stage background after the fix is `rgb(16, 20, 24)`.

### D11 — Error sentences use the mark color

| | |
|---|---|
| Severity | Medium |
| Where | `frontend/app/settings.tsx` (ranking, plan, language, sign out), `frontend/app/workout/[id].tsx` share error |
| Repro | Read those styles. `colors.error` (`#E23B3B`) on `#101418` is about 4.34:1. Spec: sentences use `errorText`. |
| Acceptance | Those sentences and the sign-out label use `errorText`. Icons and borders may stay on the mark color. |

Fixed.

### D12 — Loading Home still draws three dials

| | |
|---|---|
| Severity | Low |
| Where | Home skeleton |
| Repro | Slow `GET /home/today` and look at `home-skeleton`. |
| Evidence | Three 96 px circles. Spec: `surface3` blocks in the shape of meter rows, label “Loading home”, no shimmer. |
| Acceptance | `home-skeleton` is three bars and its accessible name is still “Loading home”. |

Fixed.

### D13 — Play demo is only an icon

| | |
|---|---|
| Severity | Low |
| Where | `frontend/app/(tabs)/workouts.tsx` |
| Repro | Open the library. |
| Evidence | The control was a 44 px circle with a play icon. Spec: an outline button using `edge`, with the words “Play demo”. The accessible name already described the exercise. |
| Acceptance | The words “Play demo” are visible, the outline uses `edge`, and the hit target stays at least 44 px. |

Fixed. `after-library-390.png`.

### D14 — Status words at 9 px

| | |
|---|---|
| Severity | Low |
| Where | Sources mode badge, labs flag severity, analysis series titles, Home quick labels and week letters |
| Repro | Read those styles, and the rendered Home and Sources screens. |
| Evidence | Several labels were 9–11 px. `textMuted` contrast passes; the size does not match the 12 px eyebrow. |
| Acceptance | Home quick labels, week letters, Sources mode text, labs flag severity, and trend titles are at least 12 px. |

Fixed for those call sites. Older screens (profile wall, community chrome, progression) still have 9–11 px labels. They were not part of this failure and were left alone.

## Invariants

| Invariant | Result |
|---|---|
| Unknown is not zero | Held, before and after. Null recovery is **—** / Not connected. |
| A recorded zero stays zero | Held. Simulated strain 0 shows **0** and **Sample data**. |
| Sample is never labeled live | Held on Home meters and on Sources. |
| No invented trend or health conclusion | The green/red fallback was the violation. It is removed. Readiness and labs keep the non-diagnosis lines. The chart does not drop a gap to zero. |
| No invented success toast | Not introduced. Finish and sync copy were not changed into a success toast. |
| No workout data loss | Add-set validation still refuses a bad row. The retry-sync control from the night-studio pass is still in the logger. This review did not delete sets. |
| Staff console appearance | Unchanged versus the athlete-experience commit. Not restyled. Not opened in a second Expo process during this pass. |
| Privacy and consent | Settings still has the ranking opt-in (off by default in the copy) and the private-account switch. This review did not change those requests. |

## Critical flows

Judged on the web build with mocked APIs, at the viewports above.

| Flow | Result |
|---|---|
| Start / resume | Resume is the only primary while a workout is open. Start day still opens the merge sheet in the night-studio spec (covered by `athlete-night-studio.spec.ts`; re-run with the full Playwright suite). |
| Add sets | Empty reps show the inline error and do not start rest. |
| Rest timer | Not started by the invalid add. A valid add was not replayed in the screenshot pass. |
| Change exercises | Library select, filters, and Play demo render. The demo modal was not played (no video file). |
| Failed sync | Retry control remains in the logger source. Not re-failed in the screenshot pass. |
| Finish workout | Not clicked through to the share sheet in this visual pass. The entry bar and finish gate were not removed. |
| Browse exercises | Library renders posters, the placeholder word inside the tile, and Play demo. |
| Unknown wearable readings | Em dash and Not connected. Sample numbers stay labeled Sample data. |
| Community | With no club, Find a club is the brand action. Feed, scopes, and composer render. An athlete who already has a club was not re-rendered here; the night-studio code still swaps that action to the club. |
| Health reports | Labs education banner and the empty upload state render. A populated panel was not in the fixture. Flag severity type is 12 px. |

## Tests

`npx tsc --noEmit` in `frontend/`: **pass** (after the review fixes).

Yarn / node unit tests, all exit 0:

- `yarn test:metric-state`
- `yarn test:sentry-gate`
- `yarn test:activity-day`
- `yarn test:recorder`
- `node --experimental-strip-types src/weekly-review.test.ts`
- `node --experimental-strip-types src/linking.test.ts`
- `node --experimental-strip-types src/training-week.test.ts`
- `node --experimental-strip-types src/profile-patch.test.ts`

There is no single `yarn test` script. `frontend/src/notification-runtime.test.ts` has no yarn script and was **not** run. It drives `expo-notifications` and is outside this diff.

Full Playwright (`npx playwright test` from `frontend/`, desktop 1440 and mobile 390): **see the last commit note in this file after the suite finishes.** A passing suite would not, by itself, approve the branch.

## What is still unfinished

- No commissioned stage or coach photograph. The wash and the app icon are stand-ins, not the pictures in `docs/design-refs/`.
- On a wide window the week ledger is full width under the split, not only in the right column.
- Native safe area, keyboard, camera, and GPS are untested.
- Live backend was not booted.
- Staff was confirmed from the diff, not from a fresh staff-web screenshot in this pass.
- 9–11 px labels remain on screens this review did not restyle.

## Verdict

**Not ready to merge to `main`.**

The Night Studio defects above are fixed on the review branch, and the honesty rules (unknown, zero, sample, no invented green/red day) hold on the web fixtures. That is not a main merge. This stack is still a large member-app visual change on top of `b4764b8`, it has no device pass, and it has no live API pass in this review. The stage the spec draws is a photograph this repo does not have a license to ship. Merge the review fixes into `design/athlete-night-studio` first. Do not merge that branch to `main` until a device pass and a live backend pass exist.
