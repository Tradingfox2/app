# Athlete app audit

Scope: `frontend/app` and member components. Staff (`frontend/staff`, `frontend/src/components/admin`) was inspected for shared-token leakage and then left on `staffColors`. Source review plus rendered Playwright screenshots at 1440×900, 1280×800, 768×1024, and 390×844. Baseline shots are in the redesign report. Native iOS and Android were not run in this environment.

Base commit inspected: `7867a5e`.

## Route inventory

| Route | Role |
|---|---|
| `index.tsx`, `auth.tsx` | Gate and sign-in |
| `(tabs)/home.tsx` | Daily command center |
| `(tabs)/workouts.tsx` | Sessions and exercise library |
| `workout/[id].tsx` | Live logger |
| `program.tsx`, `muscles.tsx`, `progression/[id].tsx` | Plan, anatomy, PR |
| `activity.tsx`, `analysis.tsx` | Day detail and trends |
| `morning.tsx`, `labs.tsx`, `sources.tsx` | Check-in, biomarkers, wearables |
| `(tabs)/community.tsx` and `community/*`, `channel/*`, `live/*` | Clubs, feed, rooms |
| `(tabs)/profile.tsx`, `profile-edit.tsx`, `user/*`, `post/*`, `story/*`, `saved.tsx`, `search.tsx`, `tag/*` | Profile and social |
| `messages.tsx`, `dm/[id].tsx`, `notifications.tsx`, `notification-settings.tsx` | Messages and alerts |
| `checkin.tsx`, `gym/manage.tsx`, `record/*` | Gym check-in and outdoor record |
| `settings.tsx`, `pro.tsx`, `join.tsx`, `invite/*`, `support/*`, `partner/*`, `coach/*`, `friends.tsx`, `follow-requests.tsx` | Account, billing, support, coach |

## Findings

| ID | Severity | Confidence | Where | Evidence | Expected | Impact | Fix | Regression risk | Acceptance |
|---|---|---|---|---|---|---|---|---|---|
| A1 | High | Confirmed | `home.tsx` | File was 1116 lines: load, rings, week, heatmap, and styles in one component. Rendered home stacked rings above the session. | Greeting, then the session, then honest metrics. | Hard to see what to do today. | Session hero moved first. Structure kept in the route so testIDs stay. | Medium. Wave A clicks `today-start-day` and `start-workout-cta`. | Home shows the plan and start control before the rings. |
| A2 | High | Confirmed | `home.tsx` rings | `strain/recovery/sleep/hrv/resting_hr` used `?? 0`. Baseline screenshot `home-unknown-1440x900.png` shows Recovery `0%` and Sleep `0h` when the payload is null. HRV and RHR used a truthy check, so a real `0` became `—`. | Null is unknown. Zero is a measurement. | Athletes read a failed or empty sensor as a real zero. | `readMeasured` / `measuredNumber`. Captions: Not connected, Not measured, Recorded zero, Measured. | Medium. New Wave A case. | Missing recovery/sleep/HRV render `—`. Resting HR `0` renders `0` and "Recorded zero". |
| A3 | High | Confirmed | Home readiness | `COMPUTED_METRICS.md`: null score means unknown. Home only used `confidence < 0.5` for the morning link and never showed the score. | Score, unknown, missing inputs, and coverage, with a non-medical caption. | Low confidence looked like silence, and a null score could be confused with a bad day. | Readiness card from `readReadiness`. | Low. Morning CTA test still keys off confidence. | Unknown score shows `—` and the missing names. A numeric score, including 0, is shown as a score. |
| A4 | Medium | Confirmed | `design_guidelines.json` vs `theme.ts` | Guidelines said `#121212`, `#D4FF00`, Satoshi, zero shadow. App rendered `#101418`, `#D6E35A`, Inter from a CDN. | One member system. Staff section stays Precision Performance. | Agents restyle the wrong product. | Guidelines rewritten. Staff block kept. Member tokens are `palette.ts`. | Low if staff keeps `staffColors`. | Staff specs still pass. Member ground stays `#101418`. |
| A5 | High | Confirmed | `textDim` | `#6E767E` on `#101418` is about 4.01:1 and on `#1A1F24` about 3.60:1. | 4.5:1 for small text. | Captions fail AA. | `textDim` is `#A8B2BC`. `*Text` tokens for status copy. Contrast test covers 23 pairs. | Low. Staff `textDim` unchanged. | `yarn test:metric-state` passes. |
| A6 | Medium | Confirmed | `(tabs)/_layout.tsx` | Workout tab used `add-circle` and opened Sessions / Library. The add action is `fab-new-workout`. | Icon matches a log, not a create button. | People expect the tab itself to start a set. | Tab icon is `barbell`. FAB remains the create control. | Low. No test asserts the icon name. | Tab still opens `workouts-screen`. |
| A7 | Medium | Confirmed | `(tabs)/community.tsx` | Five section tabs, feed scope chips, and four header icons shared one row with the title. | Title first. Tools on their own row. One primary action in the band. | Header actions compete with Feed / Discover. | Tools moved to a second row. Targets are 44px. Tabs and privacy APIs unchanged. | Medium. Specs use `open-messages`, `community-tab-*`, `feed-scope-*`. | Those testIDs still resolve. |
| A8 | High | Confirmed | `workout/[id].tsx` | Entry bar stayed mounted after finish. Skip control was 36px and labeled "Rest". Inputs were 48px. Logger memory was `sessionStorage` only. | Large inputs, visible rest, skip, sync copy, no entry bar on the summary, sets survive a native reload. | Keyboard and summary fight the bar. A process restart on a phone drops the in-memory log. | Bar hidden when finished. Inputs 56px. Rest timer 32px numeric. Skip is 44px. Optimistic rows say Saving. Snapshot also written through `storage`. | High. Finish, add-set, and offline tests. | Finish shows `share-panel` without the entry bar. Failed writes keep local rows. |
| A9 | Medium | Confirmed | Screen headers | Home titles were 28/800. Labs, sources, check-in, logger, and plan used 14–15px with letter-spacing 3. | One display face and one title size. | The product feels like several apps. | Display type is Barlow Condensed. Those headers drop the tracking. | Low. | Headers no longer use letter-spacing 3 except the referral code, which is a code. |
| A10 | Medium | Confirmed | `avatar.tsx`, `media.tsx` | `Image` had no error path. `expo-image` was installed and unused. | Cache plus a placeholder. | Broken remote photos leave a blank. | `ReliableImage`. | Medium. Feed and avatar tests. | A failed URI shows the placeholder instead of a broken image. |
| A11 | Medium | Confirmed | Native | `quality-issues.md` records Android keyboard and Expo Go failures that web e2e cannot see. Logger hydration on device was not executed here. | Say so. | A green web run is not a phone run. | Web coverage extended. Native left open. | — | Report states the limit. |

## Rejected or narrowed

- Staff "Precision Performance" is not the member spec. Confirmed and kept separate.
- Activity day already distinguishes unavailable figures (`activity.tsx` `FigureState`). It was not painting wearable nulls as zero. Trends already omit null points (`analysis.tsx`).
- Workout filters, demos, planned selection, offline queue, and audience sharing were present and kept.
