# Bot D QA — `release/bot-c-fixes`

Independent QA, accessibility, and regression review. This reviewer did not implement the fixes. The subject is `release/bot-c-fixes` at `8203eb32448e5de16cd0ea20e101ebfa0ac8e3dc` (“Keep the check-in countdown id and silence the plate warning.”), compared with `origin/release/plan`. The implementation plan is `docs/release/bot-e-plan.md`. The earlier findings review is `docs/release/bot-d-findings-review.md`. Bot D severity in that review wins where Bot A and Bot B disagree.

The initial review did not modify application code. After the defects and leftovers below were written down, no in-scope product defect remained that Bot C’s rules allow fixing. A-14 (“1 sets”) and the 40px language chips are accepted leftovers the plan forbids changing. No application file was edited after this review, so the re-review is the same tree at `8203eb3`.

An item is called resolved only when the current source was read and a relevant test actually ran and passed. `tsc` was not run in this review and is not treated as approval.

## How this was judged

- Source read of the 20-file diff `origin/release/plan...8203eb3` (1,534 insertions, 146 deletions).
- Member web on port 8082 and staff web (`IRONFLOW_WEB_TARGET=staff`) on port 8083, Playwright 1.63.0, Chromium, mocked `/api`, locale `en-US`, `EXPO_PUBLIC_SENTRY_DISABLED=1`, `CI=1`.
- Official projects: desktop 1440×900 and mobile 390×844 (`isMobile`, `hasTouch`). Extra projects, only for the release spec: tablet 768×1024 and laptop 1280×800 (`/tmp/pw-mid.config.ts`, not committed).
- Critical journey in `/tmp/qa-journey.spec.ts` (not committed): form sign-in, today’s plan, start day, record a set, failed sync, retry, finish, confirm home and the session list. Run once at each of 390×844, 768×1024, 1280×800, and 1440×900.
- MongoDB 8.0.13 on `127.0.0.1:27017`. Backend pytest from `/workspace/backend` with `/tmp/venv` (Python 3.12). `pytest.ini` still uses `-n 2 --dist loadscope`.
- Native iOS and Android were not launched.

## Resolved items

Each row was read in the current source and passed the named test on the runs below.

| ID | Sev. | What the current code does | Test that passed |
|---|---|---|---|
| A-01 | P1 | After a set syncs, `adoptServerSets` clears only the exact sync sentences, then merges server sets. Finish stays closed while the queue is pending (`frontend/app/workout/[id].tsx`). | `A-01 a synced set clears the sync-closed alert and Saving`; `A-01 an empty flush leaves Session did not finish in place` |
| A-02 | P1 | Dirty flags reset when the exercise or `nextSetIndex` changes. A late previous-sets payload fills a field only when that field is still clean. | `A-02 previous-sets does not overwrite typed reps and weight`; `A-02 an untouched logger takes the previous-set hint` |
| A-03 | P1 | Logger reps, weight, and RPE start as `""`. Add does not post the old 8/60/7 defaults. | `A-03 logger opens empty and add does not post` |
| A-04 | P1 | `listOpenSessions` throws when `api.workouts()` throws. Home and the plan fail closed and do not start another workout. | `A-04 home fails closed when the session list fails`; `A-04 plan fails closed when the session list fails`; `A-04 one open lift shows the merge sheet until New session` |
| A-05 | P1 | `sessionMeta` prints minutes only for a finite `duration_sec`. An open row says “in progress” and does not say 0 min (`frontend/app/(tabs)/workouts.tsx`). | `A-05 null duration is not 0 min, zero stays, and an open row stays in progress` |
| A-07 | P1 | A plan the client schema rejects sets `loadError`, hides Generate, and does not archive the active plan (`frontend/app/program.tsx`). `backend/routers/program.py` was not changed. | `A-07 an unreadable active plan is an error, not Generate`; `A-07 a schema-valid plan still shows the day` |
| D-01 | P2 | `receiptMinutes` returns null for a non-number. The receipt renders “—” (`session-summary`). A real 0 stays 0 min. This is separate from A-05. | `D-01 null duration on the receipt is not 0 min`; `D-01 a real zero duration stays 0 min and 2400 is 40 min` |
| D-02 | P2 | `finish_workout` stores `duration_sec` null when `started_at` is missing (`backend/server.py` line 841). Existing 0 rows are not migrated. | `pytest tests/test_analytics.py::test_finish_without_started_at_stores_null_duration` and `::test_finishing_a_workout_records_one_completion` — 2 passed |
| A-06 | P2 | A missing reward distance omits both reward sentences. A finite count still renders. `goTrain` was not changed (`frontend/app/checkin.tsx`). | `A-06 a missing reward distance is not NaN or 0 visits`; `A-06 one reward sentence for 7, and zero stays when the reward is unlocked` |
| A-08 | P2 | `request` throws “The server response was not valid JSON.” only for a non-empty non-JSON 2xx. An empty body still returns null. `login` / `register` set the token only when `access_token` is a string (`frontend/src/api.ts`, `frontend/src/auth-context.tsx`). | `A-08 a non-JSON login stays on auth without access_token` |
| A-09 | P2 | Sign-in and library plates no longer say Placeholder. Same glyph work as B-1. | `A-09 and B-1 member screens drop Placeholder and the template mark` |
| A-10 | P2 | The checked language is `user.preferred_locale`, otherwise the running locale. A tap on the already-checked language does not PATCH. `aria-checked` is set. Chip fill and border were not restyled (`frontend/app/settings.tsx`). | `A-10 English is checked when the profile has no locale, and a tap does not patch`; `A-10 a French profile checks French and shows French` |
| A-11 | P2 | Sign-in submit is a button named “Sign in” / “Create account”. The error is `accessibilityRole="alert"`. The role chip is a radio with `aria-checked` (`frontend/app/auth.tsx`). | `A-11 and B-6 a 401 exposes the button, the alert, and errorText` |
| A-12 | P2 | A session row is a button whose accessible name is the title plus `sessionMeta`, using the A-05 duration rule. | `A-12 an open session row has an accessible name` |
| A-13 | P2 | New session with one open workout navigates through `openSessionHref` and does not POST. An `activity` row goes to `/record/{id}`. Two open rows are named in a sheet (`frontend/src/open-session.ts`, `frontend/app/(tabs)/workouts.tsx`). | `A-13 new session resumes the open lift and does not post`; `A-13 a finished list still creates a session`; `A-13 an open activity does not open the lift logger` |
| B-1 | P2 | `IronflowMark` is the member glyph. Unknown equipment is `NeutralPlate` (`equipment-glyph-plate`), not the barbell (`frontend/src/components/night/plate-glyphs.tsx`). Staff favicon, `icon.png`, `adaptive-icon.png`, `splash-image.png`, `favicon.png`, and `frontend/app.config.js` were not changed. No face SVG. No SVG imported from `docs/`. | `A-09 and B-1 member screens drop Placeholder and the template mark`; `B-1 staff sign-in keeps the chevron`; `B-1 guidelines and member source have no stock photo URLs` |
| B-2 | P2 | Wordmark uses `fonts.displayStrong`, weight 400, 40px, letterSpacing 0.2. Above 480px the form is `maxWidth` 420 and centered. Home’s 1120 shell was not lowered. | `B-2 wordmark and the email field sit under the mark` (desktop and mobile); `B-2 home stage stays wide on desktop` |
| B-6 | P2 | Sign-in error and the session-list error sentence use `colors.errorText` (`#FFB4AE`). `colors.error` was not replaced repo-wide. Staff lock icon stays `rgb(226, 59, 59)`. | `A-11 and B-6 a 401 exposes the button, the alert, and errorText`; `B-6 a failed session list uses the same readable color`; `B-6 the staff lock icon stays the mark red` |
| D-03 | P2 | `aria-checked` / `aria-expanded` are set in addition to `accessibilityState`. `aria-expanded` was added only on `admin-nav-menu` (`frontend/staff/index.tsx`). | `D-03 staff menu exposes aria-expanded and the helper clicks once` (mobile project; one click) |
| Staff helper | P2 | `frontend/e2e/staff-nav.ts` clicks Menu a second time only while the accessible name is still “Menu”. It does not use `aria-expanded` as the open signal. Staff layout was not changed. | Same D-03 test, plus the three mobile admin cases listed under verification |

## Critical journey

`/tmp/qa-journey.spec.ts` via `/tmp/pw-journey.config.ts`. Final run: **4 passed (15.9s)**, one per viewport (390, 768, 1280, 1440).

Each run used the sign-in form, opened today’s plan, started the day, confirmed empty inputs, typed 5 reps and 80 kg, held the first set POST at 500, saw Finish stay closed (`finish-error`, no share panel), retried, saw Saving and the finish alert clear, still showed 5 reps and 80 kg, finished, and checked the receipt and the session list.

Checked on that run:

- Receipt contained “40 min” and “400 kg”, and its text did not match a standalone “0 min”.
- Posted body was `{ reps: 5, weight_kg: 80, exercise_id: "ex-1", set_index: 1 }`.
- Done returned to home. The resume CTA was absent.
- Session meta contained “40 min”, did not match standalone “0 min”, and did not say “in progress”.
- Auth document overflow was 0. The email field sat under the mark with width ≤ 420 at all four viewports.
- Logger document overflow was ≤ 1.
- Home during the plan showed readiness “—” and strain “Not connected” (null metrics, disconnected wearables).

A refocus probe on the same file, after a blocked Finish, flipped the mock to success and left the logger via home. Remounting ran `load()`, which merged the server set. `finish-error` and Saving were both gone. That is not a stuck-alert defect. A residual in-place NetInfo flush that never calls `adoptServerSets` was not reproduced as a stuck state.

The receipt text on that journey was “1 sets · 40 min · 400 kg”. See A-14 below.

## Viewports and suites that ran

Release spec `npx playwright test e2e/release-athlete.spec.ts` from `/workspace/frontend` with `CI=1`:

| Run | Result |
|---|---|
| `--project=desktop` (1440×900) | 30 passed, 1 skipped. Skip: D-03, which runs only when the project is named `mobile`. |
| `--project=mobile` (390×844) | 30 passed, 1 skipped. Skip: B-2 home stage, which runs only when the project is named `desktop`. Then three mobile admin cases passed: moderator resolves a report and must give a reason to suspend; audit tab shows who did what; support queue can hide assigned tickets. |
| `/tmp/pw-mid.config.ts` tablet 768×1024 and laptop 1280×800 | 56 passed, 4 skipped, 2 failed. Both failures are `release-athlete.spec.ts:799`, `expect(project.name === "mobile" \|\| project.name === "desktop")`, after width ≤ 420, email below the mark, and `font-family` containing `IronflowDisplayStrong` had already passed. Skips are B-2 home stage and D-03, once per extra project. This is a project-name guard in the spec, not a layout failure. The assertion was not weakened. Official desktop and mobile runs passed the same test. |

Layout sweep in the journey file (earlier process, 6/6 passed) measured auth overflow 0 and submit size at 390 (342×52), 768 (372×52), 1280 (372×52), and 1440 (372×52). Staff signed-out auth overflow was 0. The chevron path `M14 50 L28 18` was present once. The member monogram path was absent. Tab from email focused `input-password`. `language-en` had `aria-checked=true` when the profile had no `preferred_locale` (chip box about 101.8×40). Sample home: strain “0” and “Sample data”, recovery “80” and “Sample data”, readiness “—”. No Placeholder text and no `img` on signed-out auth. The mark rect has a stroke.

Full Playwright on this commit, `CI=1 npx playwright test --reporter=line` from `/workspace/frontend`: **4 skipped, 450 passed (13.4m)**. Exit 0. The four skips are the source `test.skip` calls: workout-affordance hover (mobile), workout-affordance reduced-motion hover (mobile), B-2 home stage (not desktop), D-03 menu (not mobile). Staff `admin.spec.ts` and `management.spec.ts` skips did not fire; the staff server was up.

Backend, local Mongo: **361 passed, 2 skipped, 6 warnings in 18.97s**. The two skips are `backend/tests/backend_test.py` and `backend/tests/test_community_integration.py` because `EXPO_PUBLIC_BACKEND_URL` is unset. Warnings: Starlette `PendingDeprecation` on `python_multipart`, and PyJWT `InsecureKeyLengthWarning` (16-byte HMAC) in community and realtime tests. The explicit D-02 pair was **2 passed in 0.79s**.

## Non-blocking issues

These were seen in the current app. They are not release blockers. No code was changed for them.

- **A-14 (P3, deferred by the plan).** A one-set receipt still says “1 sets”. The plan forbids editing the `{count} sets` string. Confirmed on the journey receipt. Regression coverage is the journey observation, not a new assertion that would require changing the copy.
- **Settings language chips.** `minHeight` is 40. The measured chip was about 40px tall. The plan says not to restyle chip fill or border. WCAG 2.5.8 (24px) is met. The 44px target belongs to deferred B-3. `aria-checked` did pass.
- **Auth submit focus ring.** Programmatic focus on `auth-submit-btn` computed `outlineStyle` `auto` (browser default). The control is a raw `Pressable`, so it does not get the Affordance 2px ring. Tab order from email to password works. A-11’s role, name, and alert passed. Not a new blocker.
- **Home `resume()`.** It still pushes `/workout/{id}`. `home/today` does not send `activity`, so this path was not given `openSessionHref`. The workouts FAB and row press do use the helper. A-13 tests passed, including an open run going to `/record/run-1`.

Deferred on purpose and not re-tested as product fixes: B-3, B-4, B-5, B-7, B-8, B-9, B-11, and the B-10 URL deletion outside the three URLs removed inside B-1.

## Not tested

- Native iOS and Android: no simulator, no device, no native keyboard, no Expo Go, no camera QR check-in, no GPS record, no process kill, no on-device offline-queue resume. Installed icon, splash, and favicon were left unchanged and were not installed.
- Live HTTP against a deployed or preview backend. The two pytest modules that need `EXPO_PUBLIC_BACKEND_URL` were skipped. Local Mongo pytest did run. `uvicorn` was not used as a public server.
- `tsc` was not run.

Staff console appearance: the diff does not restyle staff layout, tokens, favicon, or `frontend/staff/auth.tsx`. The chevron test, the lock-icon color, and the three mobile admin cases passed.

## Verdict

PASS WITH NON-BLOCKING ISSUES

Release blockers: none.
