# Bot E — Approved plan

A, B, and D-pre agree on one implementation. This is the plan Bot C builds.

## Geometry (`callout-geometry.ts`, pure)

- Parse every `MusclePathDefinition.path` into sampled contours (M/L/H/V/C/S/Q/T/A/Z, including compact arc flags).
- Per region: bbox and an interior point (grid search over the fill). Per slug on that side: union bbox.
- Anchor: an interior point of a member fill, inside the union bbox. Never `labelX` / `labelY`. Never a gap centroid.
- Leader: polyline in viewBox space to the nearer clear gutter (8 units inside the viewBox edge). Prefer a short exit from the muscle's own lateral edge. Allow one elbow through space that is not inside another slug. Abs uses its clear lateral exit as the anchor.
- One plan per slug per side that draws it (shoulders and forearms on both).
- Slots: rectangles in the outer gutter, centered on the label end, separated so rectangles on the same gutter do not intersect. A vertical segment at the gutter x may join the clear exit to the slot. That segment is part of the tested polyline.
- Unit test: every `MUSCLE_SLUGS` entry has a plan on its home side; anchor ∈ union bbox and ∈ some member bbox; anchor is inside the sampled fill; slots on a gutter are disjoint; leader samples that are outside the slug's fill are outside every other slug; repeat run is stable; a knowledge record with a missing pair does not become 0.

## UI

- `muscle-callout.tsx`: sequence hook (reanimated shared values, cancel on change, timer cleared) and the label. Line component uses `Animated.createAnimatedComponent(Path)` with `strokeDashoffset`.
- `muscle-heatmap.tsx`: optional `callout` prop. Absent on Home. When present, leader SVG overlays the matching body inside the yaw view; wide layout adds the gutter label in that view; yaw settle is 200ms. Default props and the no-callout tree stay as they are.
- `muscle-explorer.tsx`: delete `MuscleLabelColumn` and the chip row. Pass the plan for the emphasized side when the slug is visible there. Narrow (`< 760`) renders the same label full-width under the stage. Spin stops while a slug is selected. Detail sheet, recommendations, and add-to-workout stay.
- `muscle-region.tsx` / `anatomy-body.tsx`: web paths are focusable buttons (Enter, Space, arrows) without enabling the native `onPress` that would double-toggle with the container click.
- Copy: `localizeMuscleKnowledge` plus the existing `{min}–{max}×/week` and `{min}–{max} hard sets/week` templates. Blank or non-finite fields render `t("Unavailable")`.
- Timings: 120ms out, 320ms line, then 140ms fades staggered by 90ms. Reduced motion snaps.

## Out of scope

No artwork replacement, no new muscle facts, no staff-console edits, no new dependencies, no callout on the Home preview, no edits under auth / home / workouts / logger / settings / check-in / program.

## Done when

`npx tsc --noEmit`, the new geometry test, existing `yarn` unit scripts, Playwright callout spec (every slug, both views, rapid switch, reduced motion, 390×844 and 1440×900), full Playwright, and `expo export` for Android and iOS. Screenshots of the settled callout and a short frame sequence. Bot D's final verdict recorded in `D-final.md`.
