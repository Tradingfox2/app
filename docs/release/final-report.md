# Release report — Bot E

Subject: `release/bot-c-fixes` after Bot C’s fixes (`858bc75`, `63d68d6`, `8203eb3`) and this documentation pass. Independent QA is `docs/release/bot-d-qa.md`. The plan is `docs/release/bot-e-plan.md`.

Application code is unchanged from `8203eb3`. Documentation content is `2f79cfa`. The commit after that one only writes this hash into section C.

## A. Executive verdict

**Conditionally ready.**

The 19 in-scope web defects are fixed in the current source and covered by tests that ran. Bot D’s verdict is PASS WITH NON-BLOCKING ISSUES, with no release blockers. This branch is fit for the owner to merge locally.

It is not ready to deploy. Native iOS and Android were not tested. The two live HTTP pytest modules were skipped. A-14 (“1 sets”) and the 40px language chips remain, on purpose. `main` is not deployed anywhere.

## B. Defect ledger

Resolved means the current source was read and the named test passed on a run recorded in section D. Nothing here is marked resolved from a test that did not run.

| ID | Sev. | File | Evidence | Impact | Fix or reason | Regression test that passed |
|---|---|---|---|---|---|---|
| A-01 | P1 | `frontend/app/workout/[id].tsx` | Synced set cleared the sync-closed alert and Saving. A failed finish left “Session did not finish”. | A member could finish, or think a set was still saving, after the server had the set. | `adoptServerSets` clears only those sentences, then merges. Finish stays closed while the queue is pending. | A-01 release tests (desktop, mobile, 768, 1280) and the journey |
| A-02 | P1 | `frontend/app/workout/[id].tsx` | Typed reps and weight survived a late previous-sets response. An untouched field still took the hint. | Typed numbers could be replaced by history. | Dirty flags block the hint. Shipped with A-03. | A-02 release tests |
| A-03 | P1 | `frontend/app/workout/[id].tsx` | Logger opened empty. Add did not post 8/60/7. | One tap logged invented numbers. | Initial fields are `""`. | A-03 release test and the journey (empty inputs, then 5×80 posted) |
| A-04 | P1 | `frontend/src/open-session.ts`, `frontend/app/(tabs)/home.tsx`, `frontend/app/program.tsx` | A failed session list showed an error and did not create a workout. | Start day could open a second workout. | `listOpenSessions` throws. Callers fail closed. | A-04 release tests |
| A-05 | P1 | `frontend/app/(tabs)/workouts.tsx` | Null duration was not “0 min”. A real 0 stayed. An open row said “in progress”. | A finished session with no duration looked like zero minutes. | `sessionMeta` prints minutes only for a finite number. | A-05 release test and the journey session row |
| A-07 | P1 | `frontend/app/program.tsx` | An unreadable plan showed “Could not load your plan.” and hid Generate. A valid plan still showed the day. | Generate would archive the active plan. | Schema failure sets `loadError` and does not offer Generate. `backend/routers/program.py` was not changed. | A-07 release tests |
| D-01 | P2 | `frontend/app/workout/[id].tsx` | Null duration on the receipt was not “0 min”. 0 stayed 0 min. 2400 was 40 min. | The finish receipt lied when `duration_sec` was null. A-05 does not cover this surface. | `receiptMinutes` returns null. The receipt renders “—”. | D-01 release tests and the journey receipt |
| D-02 | P2 | `backend/server.py` | Finish without `started_at` stored `duration_sec` null, set `ended_at`, and did not set `load_au`. | The server wrote 0 minutes for a missing start. | `duration` is null when `started` is missing. Existing 0 rows were not migrated. | `test_finish_without_started_at_stores_null_duration` and `test_finishing_a_workout_records_one_completion` (2 passed) |
| A-06 | P2 | `frontend/app/checkin.tsx` | A missing reward distance did not render NaN or “0 visits”. A finite 7 still rendered. Zero stayed when unlocked. | The reward line looked broken or invented a visit count. | Missing distance omits both sentences. `goTrain` was not changed. | A-06 release tests |
| A-08 | P2 | `frontend/src/api.ts`, `frontend/src/auth-context.tsx` | A non-JSON login 200 stayed on auth and did not mention `access_token` as a stored token. | The client threw, or stored a non-string token. | Throw only for a non-empty non-JSON 2xx. Token is set only when `access_token` is a string. Empty 204 still returns null. | A-08 release test |
| A-09 | P2 | `frontend/app/auth.tsx`, `frontend/src/components/night/coach-mark.tsx`, `frontend/src/components/night/plate-glyphs.tsx` | Signed-out auth and plates had no Placeholder text and no template image. | The Expo template mark and the word Placeholder shipped on member screens. | Member glyph and equipment plates. Same root as B-1. | A-09 / B-1 release test and the journey glyph sweep |
| A-10 | P2 | `frontend/app/settings.tsx` | With no `preferred_locale`, English was `aria-checked` and a tap did not PATCH. A French profile checked French. | Settings showed French while the UI was English. The radio had no `aria-checked`. | Checked language follows the profile, then the running locale. `aria-checked` is set. Fill and border were not restyled. | A-10 release tests and the journey chip probe |
| A-11 | P2 | `frontend/app/auth.tsx` | Wrong password exposed a button named Sign in, an alert, and `colors.errorText`. The athlete chip had `aria-checked="true"`. | Submit, the error, and the role chip were weakly exposed on web. | Roles, names, and `aria-checked` added. | A-11 release test. Journey: wrong-password copy was not re-asserted as its own case; the release test is the one that ran for this item. |
| A-12 | P2 | `frontend/app/(tabs)/workouts.tsx` | An open row’s accessible name included the title and “in progress”. | A session row had no accessible name. | `accessibilityRole="button"` and a label from title plus `sessionMeta`. | A-12 release test |
| A-13 | P2 | `frontend/app/(tabs)/workouts.tsx`, `frontend/src/open-session.ts` | One open lift resumed and did not POST. A finished list created a session. An open run went to `/record/run-1`. | New session created a second workout, or sent a run to the lift logger. | `openSessionHref`. Two open rows are named. | A-13 release tests |
| B-1 | P2 | `frontend/src/components/night/plate-glyphs.tsx`, `design_guidelines.json` | Member screens used `ironflow-mark`. Unknown equipment is the neutral plate. Staff sign-in kept the chevron. Stock photo URLs were gone from guidelines and member source. | The Expo template mark and placeholder plates shipped. | Member glyphs. Staff favicon, app icon, splash, and `app.config.js` were not changed. No face SVG. | B-1 release tests and the journey staff/member glyph sweep |
| B-2 | P2 | `frontend/app/auth.tsx` | Email width ≤ 420, email below the mark, wordmark family contained `IronflowDisplayStrong`. Desktop home stage width was between 640 and 700. | The wordmark was system-ui at weight 900 and the form overlapped the hero. | `fonts.displayStrong`, weight 400, 40px, letterSpacing 0.2. Form maxWidth 420 above 480px. Home’s 1120 shell was not lowered. | B-2 release tests on desktop and mobile. At 768 and 1280 the layout assertions passed; the following project-name guard failed because those projects are not named `mobile` or `desktop`. The journey also checked the form at all four viewports. |
| B-6 | P2 | `frontend/app/auth.tsx`, `frontend/app/(tabs)/workouts.tsx` | Sign-in and session-list errors computed as `rgb(255, 180, 174)`. Staff suspend icon stayed `rgb(226, 59, 59)`. | Those two sentences were `#E23B3B` at 4.34:1. | Only those sentence styles use `colors.errorText`. `colors.error` was not replaced repo-wide. | B-6 release tests |
| D-03 | P2 | `frontend/staff/index.tsx`, member radios in auth and settings | Staff menu `aria-expanded` went from false to true. Language and role radios exposed `aria-checked`. | On this web build `accessibilityState` does not become `aria-checked` or `aria-expanded`. | Aria props set beside `accessibilityState`. `aria-expanded` only on `admin-nav-menu`. | D-03 on the mobile project (one click). A-10 and A-11 for `aria-checked`. |
| Staff helper | P2 | `frontend/e2e/staff-nav.ts` | D-03 recorded one menu click and the drawer opened. Three historical mobile admin cases passed. | A second Menu click closed a drawer that was already open. | Retry only while the accessible name is still “Menu”. Staff layout was not changed. | D-03 and the three mobile admin cases |

Open, non-blocking:

| ID | Sev. | File | Evidence | Impact | Reason left open | Test |
|---|---|---|---|---|---|---|
| A-14 | P3 | `frontend/app/workout/[id].tsx` | Journey receipt was “1 sets · 40 min · 400 kg”. | Grammar on a one-set receipt. | The plan forbids editing the `{count} sets` string. | Observed on the journey. Not a new assertion. |
| Language chip height | P3 | `frontend/app/settings.tsx` | Chip box about 101.8×40. `minHeight` is 40. | Below a 44px product target. WCAG 2.5.8 (24px) is met. | Plan says not to restyle chip fill or border. Deferred with B-3. | Journey probe. `aria-checked` passed in A-10. |
| Auth submit focus ring | P3 | `frontend/app/auth.tsx` | Focused submit computed `outlineStyle` `auto`. | No Affordance 2px ring on that control. Keyboard tab from email to password works. | Raw `Pressable`. A-11 names and the alert passed. Not a release blocker. | Journey focus probe. |

No P0. No release blocker.

## C. Changes

Application commits on `release/bot-c-fixes`, already on the branch before this report:

- `858bc75` Fix athlete release blockers from the Bot E plan.
- `63d68d6` Point the release regressions at the text and the staff tab.
- `8203eb3` Keep the check-in countdown id and silence the plate warning.

Files in `origin/release/plan...8203eb3`:

- `backend/server.py`
- `backend/tests/test_analytics.py`
- `design_guidelines.json`
- `frontend/app/(tabs)/home.tsx`
- `frontend/app/(tabs)/workouts.tsx`
- `frontend/app/auth.tsx`
- `frontend/app/checkin.tsx`
- `frontend/app/program.tsx`
- `frontend/app/settings.tsx`
- `frontend/app/workout/[id].tsx`
- `frontend/e2e/athlete-night-studio.spec.ts`
- `frontend/e2e/release-athlete.spec.ts`
- `frontend/e2e/staff-nav.ts`
- `frontend/e2e/workout-affordance.spec.ts`
- `frontend/src/api.ts`
- `frontend/src/auth-context.tsx`
- `frontend/src/components/night/coach-mark.tsx`
- `frontend/src/components/night/plate-glyphs.tsx`
- `frontend/src/open-session.ts`
- `frontend/staff/index.tsx`

Documentation commit: `2f79cfa` Record Bot D QA and the Bot E release report. It adds this report and `docs/release/bot-d-qa.md`, and it corrects the three athlete documents below. No application code is in that commit. The following commit only replaces a placeholder in this section with `2f79cfa`.

Documentation changes:

- Added `docs/release/bot-d-qa.md`.
- Added `docs/release/final-report.md` (this file).
- `docs/athlete-redesign-report.md`: the opening no longer says the redesign is unmerged. It records Night Studio on `main` at `089ec98`, SDK 57 at `9604bac`, and local-only, not deployed. The deployment section says the same. Historical Playwright counts stay labeled as historical.
- `docs/athlete-ux-audit-bot-a.md`: a current-status banner. The audit subject remains `b4764b8`. Findings were not rewritten as if re-tested.
- `docs/athlete-review-bot-d.md`: a current-status banner. The closing “do not merge” instruction is marked historical. The staff Menu note in “unfinished” is past tense and points at the later helper fix.

## D. Verification results

Commands that ran against `8203eb3` (application tree). Counts are from those processes, not from an earlier report.

| Command | Result |
|---|---|
| `CI=1 npx playwright test e2e/release-athlete.spec.ts --project=desktop` from `frontend/` | 30 passed, 1 skipped (D-03, mobile-only). About 1.1m. |
| `CI=1 npx playwright test e2e/release-athlete.spec.ts --project=mobile` | 30 passed, 1 skipped (B-2 home stage, desktop-only). 46.6s. Then three mobile admin cases: 3 passed in 7.7s. |
| Playwright with `/tmp/pw-mid.config.ts` (tablet 768×1024, laptop 1280×800), release spec only | 56 passed, 4 skipped, 2 failed. Both failures are the B-2 project-name guard at `release-athlete.spec.ts:799` after the layout assertions passed. Skips: B-2 home stage and D-03, once per project. Not a product failure. The guard was not removed. |
| `/tmp/qa-journey.spec.ts` via `/tmp/pw-journey.config.ts` | 4 passed (15.9s). One critical journey at 390, 768, 1280, and 1440. |
| Journey layout and glyph sweep (same spec, earlier process) | 6 passed. Auth overflow 0 at all four viewports. Staff chevron present. Member monogram absent. |
| `CI=1 npx playwright test --reporter=line` from `frontend/` | **4 skipped, 450 passed (13.4m).** Exit 0. Skips: workout-affordance hover, workout-affordance reduced-motion hover, B-2 home stage (not desktop), D-03 (not mobile). |
| `pytest` from `backend/` with `/tmp/venv`, MongoDB on `127.0.0.1:27017` | **361 passed, 2 skipped, 6 warnings in 18.97s.** Skips: `backend/tests/backend_test.py` and `backend/tests/test_community_integration.py` (`EXPO_PUBLIC_BACKEND_URL` unset). Warnings: Starlette `PendingDeprecation` on `python_multipart`; PyJWT `InsecureKeyLengthWarning` in community and realtime tests. |
| `pytest tests/test_analytics.py::test_finish_without_started_at_stores_null_duration tests/test_analytics.py::test_finishing_a_workout_records_one_completion -q --tb=short -n 0` | **2 passed in 0.79s.** |

No critical test failed. The two mid-viewport failures are the project-name guard described above. They do not require a product fix and are not an accepted product blocker.

Not run, and not reported as passed:

- `tsc --noEmit`
- Native iOS and Android (simulator, device, Expo Go)
- Native keyboard, safe area, camera QR check-in, GPS record, process kill, on-device offline-queue resume
- Installed icon, splash, and favicon (left unchanged on purpose; not installed)
- Live `uvicorn` or any deployed or preview backend
- The two skipped live HTTP pytest modules

### Browser vs native coverage

**Browser, tested.** Chromium via Playwright. Member web on port 8082 and staff web on port 8083. Viewports 390×844, 768×1024, 1280×800, and 1440×900 for the release spec and the critical journey. Official suite projects are desktop 1440×900 and mobile 390×844. API calls in those tests were mocked, except the backend pytest suite, which used a local MongoDB.

**Native, not tested.** No iOS simulator. No Android emulator. No physical device. No Expo Go session. Not exercised: the native keyboard, safe-area insets, the check-in camera, GPS recording, killing the process, and resuming the offline queue on a device. The shipped icon, splash, and favicon files were not installed or screenshotted on a home screen.

## E. Outstanding risks

- Native behavior can still diverge from the web build. The lift logger and its decimal pad have no device evidence, and that is the deploy gate in section G. Check-in camera, GPS, and on-device offline resume are still untested, and they are pre-existing gaps this diff did not change.
- Live API behavior is unproven in this pass. Local Mongo covered the pytest suite that does not need `EXPO_PUBLIC_BACKEND_URL`. The two live HTTP modules were skipped.
- A-14 still says “1 sets” on a one-set receipt.
- Settings language chips are about 40px tall. The auth submit focus ring is the browser default.
- Home `resume()` can still open `/workout/` for an activity, because `home/today` does not send `activity`. The workouts list and New session use `openSessionHref`.
- Deferred and untouched: B-3, B-4, B-5, B-7, B-8, B-9, B-11. Staff layout, tokens, favicon, and `frontend/staff/auth.tsx` were not restyled.
- PyJWT tests still warn on a 16-byte HMAC. That warning was not investigated as a release fix.

## F. Deployment status

Not deployed. `main` (`9604bac`, SDK 57) and this branch run locally on the owner's PC. No host, preview URL, or production deploy was inferred or performed. Do not deploy from this report.

## G. Recommended next step

Merge `release/bot-c-fixes` on the owner's PC and leave the app undeployed until one iPhone and one Android phone pass the lift logger: the decimal pad open over empty reps, weight, and RPE; a late previous-sets hint that does not replace a typed number; and the entry bar fully above the keyboard and clear of the bottom inset.

The previous wording of this section also required a check-in camera pass and a GPS pass. Bot A, Bot B, Bot C, and an independent native-risk reviewer each amended that. All four still want the local merge now, and all four still want the app left undeployed. Camera, GPS, an in-place NetInfo reconnect, and the two skipped live HTTP modules are not the gate for this branch.

The gate that remains is `frontend/app/workout/[id].tsx`. The fields use `keyboardType="decimal-pad"`. Focus alone does not set the dirty refs, so a late `previousSets` hint can still fill a field the athlete has not typed in. Playwright proved that hint with `fill()`, which commits a value. A focused pad with no character committed was not part of that run. `KeyboardAvoidingView` uses `behavior="padding"` and sets no `keyboardVerticalOffset`. `SafeAreaView` insets only the top edge. The entry bar is `position: "absolute"` at `bottom: 0`, as a sibling of the scroll view. This file does not guarantee that the bar clears the keyboard or the bottom inset. `quickAddSet` parses reps with `parseInt` and weight and RPE with `parseFloat`, with no digits filter. A device still has to show which token the pad inserts.

Bot B and Bot C preferred a shorter sentence, with the hint and the bar as notes under the same logger pass. Bot A and the native-risk reviewer wanted both outcomes named, because a covered bar or a hint that replaces a typed number means the P1 fixes are not usable on a phone. This section follows that naming. The reconnect check stays off the gate: `frontend/src/offline-queue.ts` is outside this diff, and the logger calls `adoptServerSets` from Retry sync and Finish only. `CameraView`, `goTrain`, and the recorder were not changed. They stay untested on local `main`, and they do not hold this merge.
