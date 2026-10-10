# Bot C — Implementation

Built the approved plan from E on `feature/muscle-callout` (base `9604bac`). The body artwork, muscle knowledge records, detail sheet, and Home preview behavior are unchanged. No new dependencies.

## What landed

- `frontend/src/components/anatomy/callout-geometry.ts` parses each region path (including compact arc flags), picks an interior anchor, and routes one polyline per slug. Front leaders exit left; back leaders exit right, so the label sits on the outer side of the pair. The last segment is packed in the outer margin so slots on one gutter do not overlap and the line does not enter another muscle.
- `frontend/src/components/anatomy/muscle-callout.tsx` draws that polyline in the same viewBox as the figure (`stroke-dashoffset`, 320ms) and fades the name, function, then weekly sessions and hard-set line (140ms, staggered 90ms). A selection change fades the current callout out (120ms) before the next one starts. Reduced motion snaps every value to its end state and does not draw the stroke. Missing knowledge stays null and is shown as “Unavailable”, never 0.
- `frontend/src/components/muscle-heatmap.tsx` accepts an optional `callout`. Home does not pass it. When it is set, the leader SVG shares the yaw transform and the expanded viewBox with the figure, so a settle to 0° cannot leave the line pointing at empty space. Below 760px the explorer keeps the leader and places the copy under the pair.
- `frontend/src/components/anatomy/muscle-explorer.tsx` drops `MuscleLabelColumn` and the chip row. One callout follows the selected slug. Tapping the other side of a bilateral muscle (shoulders, forearms) moves the callout to that figure. The detail sheet, recommendations, and add-to-workout path are still there.
- Web paths stay `<path>` elements. `accessibilityRole="button"` on a react-native-svg path makes react-native-web swap in an HTML button and drop the fill, so the button role is stamped on the DOM node and keyboard handling (Enter, Space, arrows) listens on the body container. The callout itself is an `aria-live="polite"` region whose label includes the name, function, and both frequencies.

## Checks

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Exit 0. A dev server had written an incomplete gitignored `.expo/types/router.d.ts`; that stub was moved aside for this run. It is not part of the diff. |
| `yarn test:callout-geometry` | Exit 0. `callout geometry ok: 7 front, 9 back`. |
| `yarn test:activity-day` | Exit 0. |
| `yarn test:metric-state` | Exit 0. Prints `metric-state contrast pairs 23`. |
| `yarn test:recorder` | Exit 0. |
| `yarn test:sentry-gate` | Exit 0. |
| Playwright `e2e/muscle-callout.spec.ts` | 9 passed, 1 skipped, 0 failed. The skip is the frame sequence on the mobile project; the same test runs at 1440×900. Both projects use 1440×900 and 390×844. |
| Full Playwright | 399 passed, 3 skipped, 0 failed (13.2m). The three skips are the mobile frame sequence plus two desktop-only hover tests in `workout-affordance.spec.ts`. |
| `expo export --platform android` | Exit 0. Bundle `/tmp/expo-export-android` (`entry-….hbc`, 10MB). |
| `expo export --platform ios` | Exit 0. Bundle `/tmp/expo-export-ios` (`entry-….hbc`, 9.8MB). |

The node unit scripts use `node:assert` and exit non-zero on failure. They do not print a TAP count.

Screenshots and the desktop frame sequence are in `/opt/cursor/artifacts/muscle-callout/` (`desktop-frame-040` through `desktop-frame-760`, plus settled calves at both viewports).

## Not tested

iOS and Android were exported, not installed on a device or simulator. Hit testing, the dash animation, and VoiceOver were verified on web only.
