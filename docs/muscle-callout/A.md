# Bot A — Selection and information audit

Main verified at `9604bac` (`Upgrade Expo SDK 54 to 57 for Expo Go`). Scope stays inside the muscle explorer. Home, workouts, logger, settings, check-in, program, and the staff console are out of bounds. The compact Home heatmap (`app/(tabs)/home.tsx`) must keep today's preview: no leader, no callout.

## What exists

Selection lives in `MuscleExplorer` (`frontend/src/components/anatomy/muscle-explorer.tsx`).

- Tap a region on either figure. `AnatomyBody` resolves the slug from the path id or `data-muscle-slug`. On web the listener is on the wrapping view, because the SVG ref is late and the figure yaws.
- Pressing the selected slug again clears selection, recommendations, and activation.
- A muscle that is not drawn on the emphasized side switches `side` to `MUSCLE_HOME_SIDE`. Shoulders and forearms are drawn on both sides (`muscle-relations.ts`).
- Selection immediately paints combination partners (`combinationActivation`), then `api.muscleRecommendations` refines activation if the request is still current (`selectedRef`).
- The detail sheet, exercise list, circuits, partner jumps, and add-to-workout toast stay mounted while a slug is selected. Those flows are not part of this change.

Information beside the figure is a second, wide control:

- `MuscleLabelColumn` at stage width ≥ 640px lists every home-side slug with localized name, `role`, sessions, and hard-set range. It is also a button.
- Below 640px, `muscleChips` are name-only buttons for every slug that has artwork.
- Copy comes from `MUSCLE_NAMES`, `MUSCLE_KNOWLEDGE`, and `localizeMuscleKnowledge`. No extra facts are stored on the paths.

`labelX` / `labelY` are not usable anchors. `frontend/scripts/build-anatomy-artwork.mjs` sets them to the average of each subpath's first `M` point. Measured against sampled outlines, those points sit on the path start (often a corner). Group centroids land near the midline (front x ≈ 365, back x ≈ 1085), which for bilateral muscles is the gap between left and right fills, not a point on the muscle.

## Interaction model (narrowest that meets the spec)

One selected slug, one callout.

1. Keep tap, second-tap clear, side switching, activation, the detail sheet, and workout actions.
2. Remove `MuscleLabelColumn` and `muscleChips` as the information surface. Do not add a second list of the same facts.
3. On select, highlight the existing regions, then draw one leader in that body's viewBox to an empty side gutter, then reveal name, role, weekly sessions, and the existing hard-set range.
4. The callout is mounted only by the explorer. `MuscleHeatmap` grows an optional prop. Home does not pass it.
5. Keyboard: region paths become tab stops on web (Enter / Space select, arrows move). The callout is an accessibility live region. Selection is not hover-only.
6. Missing role, sessions, or sets render as unavailable. They are never coerced to 0. There is no new copy about what a muscle does.

This reuses the explorer's selection state. It does not add a parallel selected-muscle store or a new anatomy model.
