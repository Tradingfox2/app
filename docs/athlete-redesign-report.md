# Athlete app redesign

**Current status (October 2026).** This report was written against `design/ironflow-athlete-experience`, branched from `origin/main` at `7867a5e`. That redesign later landed on `main` inside the Night Studio squash `089ec98`. Expo SDK 57 is `9604bac`. `main` runs locally on the owner's PC and is not deployed anywhere. The Playwright counts below are the historical result of that redesign pass, not the current suite.

Historical subject line, as written: branch `design/ironflow-athlete-experience` from `origin/main` at `7867a5e`. At the time of writing it was not merged and not deployed.

## Summary

The member app now follows **IRONFLOW MOTION — Athletic Intelligence**: charcoal `#101418`, chartreuse `#D6E35A` only for primary actions, bundled Barlow and Space Mono, and honest numbers. Missing wearable values are unknown. A real zero stays a zero. Sample sources are labeled sample. The staff console stays on Precision Performance.

Three directions were considered: a denser Whoop-style instrument panel, a Nike Training Club photo-led programme browser, and this one — a Strava-like training log with a single raised session hero and quiet data. The third was built. Photo libraries and 3D anatomy were not added; the repo has no licensed photo set, and WebGL was not justified.

## What changed

- Home leads with a greeting and the session (resume, start the planned day, or start empty), then readiness, then the rings, then the week.
- Rings and HRV / resting HR use `metric-state.ts`. Captions say Not connected, Not measured, Recorded zero, or Measured.
- Readiness shows a score, Unknown, the missing inputs, and input coverage. The caption says it is training guidance, not a medical assessment.
- The Workout tab icon is a barbell. The screen is Sessions, with the existing library, filters, demos, and new-session button.
- The logger uses larger numeric inputs, a larger rest timer, a Skip control, a Saving label on optimistic sets, and hides the entry bar after finish. Logger memory is still in `sessionStorage` on web and is also written through the app storage helper for native reloads.
- Community title and tools are on separate rows. Privacy, audience, block, mute, report, and rankings are unchanged.
- Sources mark simulated mode as sample, not live. Labs carry an educational banner. Trends say a gap is not a zero. Anatomy load says it is a share of logged volume, not a scan.
- Avatars and post photos use `expo-image` with a local placeholder on failure.
- `textDim` is `#A8B2BC` (was `#6E767E`). Twenty-three text/background pairs are asserted at 4.5:1.
- Admin tabs that imported member `colors` now import `staffColors`. Spacing and radius numbers are unchanged because staff still uses them.

## Routes

Brought into the system: home, workouts, logger, community, labs, sources, analysis, programme, check-in, progression, anatomy detail, auth shell fonts, and every screen that already used `theme.ts` colors and type.

Not a structural rewrite: messages, notifications, settings, profile editing, DMs, live rooms, support, Pro, and gym management. They inherit the palette, type, and contrast fixes. Their flows and testIDs are intact.

## Screenshots

Synthetic fixtures, Playwright, member web on port 8082. Before shots are the app at `7867a5e`. After shots are this branch.

Viewports: 1440×900, 1280×800, 768×1024, 390×844. Files live under `/opt/cursor/artifacts/athlete-before` and `/opt/cursor/artifacts/athlete-after`.

Preview again:

```bash
cd frontend
EXPO_PUBLIC_SENTRY_DISABLED=1 npx expo start --web --port 8082
SHOT_DIR=/tmp/athlete-shots node scripts/athlete-screenshots.mjs
```

## Tests

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Pass |
| `yarn test:metric-state` | Pass (23 contrast pairs) |
| `yarn test:activity-day` | Pass |
| `yarn test:recorder` | Pass |
| `npx playwright test` | Second full run, after the home-order assertion was updated: 372 passed, 2 failed, 2 skipped (12.7m). Both failures were mobile staff nav timeouts (`admin.spec.ts` moderator suspend, support queue filter). The same two tests passed on desktop in that run and passed again in 8.5s when re-run alone on the mobile project. Member specs, including the new unknown-versus-zero home case, passed on desktop and mobile. |

iOS and Android were not launched. Web e2e does not see native keyboards, Expo Go, camera check-in, or GPS recording. Logger persistence on a phone was not executed; the native path writes the same snapshot the web copy keeps in `sessionStorage`.

## Dependencies

No new packages. Added OFL font files already allowed by `frontend/assets/fonts/OFL.txt`: Barlow SemiBold, Barlow Bold, Barlow Condensed Bold. `expo-image`, `expo-linear-gradient`, and `react-native-svg` were already installed. Reanimated, Rive, Lottie, and Three were not introduced.

## Remaining

| Severity | Item | Acceptance |
|---|---|---|
| Medium | Native logger, keyboard, and check-in were not run on a device. | One pass on iOS and Android for the logger, a DM composer, and gym check-in. |
| Low | Full Playwright can time out staff mobile nav under a 376-test single worker. | Those two cases pass in isolation. A retry or a longer mobile timeout would make the suite quiet. |
| Low | Home is still one large route file. Sections moved; the file was not split. | A later split can move Week and Heatmap out without changing testIDs. |
| Low | Referral code keeps wide letter-spacing on purpose. | Leave it. It is a code, not a title. |

## Deployment

None at the time of this report. That is still true: `main` is not deployed anywhere. It runs locally on the owner's PC. Do not infer a host from this document.
