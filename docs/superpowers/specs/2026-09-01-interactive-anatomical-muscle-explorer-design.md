# Interactive Anatomical Muscle Explorer Design

Date: 2026-09-01  
Status: Approved design, awaiting specification review  
Project: IronFlow

## Goal

Replace the current geometric front/back muscle heatmap with a premium,
anatomically detailed and interactive muscle explorer. The experience must
retain the existing seven-day training-load visualization while adding muscle
selection, exercise activation previews, deterministic exercise combinations
and circuits, and optional AI circuit regeneration.

The visual-quality reference supplied by the product owner establishes the
target: visible muscle-fiber direction, convincing muscle volume, tendon
transitions and selected bone landmarks. It is reference material only. The
application will use original artwork and will not copy or redistribute the
reference image.

## Confirmed Product Decisions

- Use an original 2.5D anatomical illustration, not a rotatable 3D model.
- Present one large body at a time with swipe and explicit Front/Back controls.
- Use a neutral athletic body without gender labeling.
- Keep a compact Home preview and add a dedicated full-screen explorer.
- Tapping a muscle opens training details, exercises, combinations and circuits.
- Provide deterministic recommendations plus optional AI regeneration.
- Keep the body still during exercise previews; animate muscle activation rather
  than full limb movement.
- Preserve every existing heatmap feature and API field.
- Add the focused files needed for maintainability.

## Visual Design

### Anatomical body

The body consists of separate SVG paths for each supported muscle region. Paths
use layered fills, clipped fiber-direction strokes, edge shading and tendon
highlights to create depth without raster imagery. Neutral bone landmarks may
be visible around the clavicle, shoulder, elbow, wrist, knee and ankle where
they improve anatomical readability.

The first release supports the current IronFlow muscle taxonomy:

- Front: chest, shoulders, biceps, forearms, abs, obliques and quads.
- Back: back/trapezius, lats, rear shoulders, triceps, forearms, lower back,
  glutes, hamstrings and calves.
- Cardio remains a whole-body metric and is not represented as a muscle path.

Left and right regions are independently pressable but resolve to the same
muscle slug for data. This preserves the existing backend model while allowing
future left/right tracking.

### Color system

The normal body uses muted anatomical red with visible fibers and neutral
tendons. Training load is overlaid as a controlled tint:

- Untrained: muted anatomical red.
- Low load: soft yellow-green tint.
- Productive load: IronFlow lime.
- High load: amber.
- Overreaching: red warning treatment.

The overlay must preserve fiber and depth detail. Color is not the only signal:
the selected region also receives an outline, slight elevation and label.

### Layout

The dedicated explorer screen contains:

1. Header with title and metric mode.
2. Front/Back segmented control.
3. Large centered body occupying the visual majority of the screen.
4. Swipe hint and compact load legend.
5. Muscle detail sheet shown after selection.

The existing Home card becomes a compact preview using the same body artwork.
Pressing the preview opens `/muscles`. The Home card continues to accept
`volumes` and `max` exactly as it does today.

## Interaction and Animation

### Muscle selection

Pressing a muscle:

1. Applies an immediate outline and subtle elevation.
2. Runs one 450–650 ms contraction pulse.
3. Sweeps a highlight along the muscle-fiber direction.
4. Settles into a steady selected state.
5. Opens the detail sheet and announces the muscle through accessibility APIs.

Only the changed paths animate. The entire SVG must not rerender for each
animation frame.

### Exercise activation preview

Selecting an exercise keeps the body stationary and runs a repeatable activation
sequence:

1. Primary muscles brighten and contract first.
2. Secondary muscles activate 150–250 ms later at lower intensity.
3. Stabilizers receive a brief outline when mapped.
4. The sequence settles after one cycle; it does not pulse indefinitely.

A replay control reruns the sequence. Reduced-motion users receive an immediate
state change with no contraction or sweep.

### Front/back navigation

Users can swipe horizontally or use the Front/Back segmented control. The body
uses a short crossfade and horizontal transition rather than a simulated 3D
rotation. Selecting a muscle that exists only on the opposite side automatically
changes view once and highlights it.

## Muscle Detail Sheet

The selected-muscle sheet displays:

- Muscle name and training status.
- Seven-day sets and volume-derived load percentage.
- Last-trained date.
- Estimated recovery state and explanatory label.
- Exercises where the muscle is primary.
- Exercises where the muscle is secondary.
- Instant combinations and circuits.
- Optional “Regenerate with AI” action.

The sheet uses three internal views: Overview, Exercises and Circuits. It must
remain usable when history, secondary-muscle mappings or AI are unavailable.

## Recommendation Behavior

### Deterministic recommendations

Rules-based recommendations are the default because they are instant,
predictable and available offline after catalog loading.

- Single-muscle combinations choose two to four exercises with different
  equipment or movement patterns.
- Antagonist combinations pair compatible groups, such as chest/back,
  biceps/triceps and quads/hamstrings.
- Circuits contain three to five known exercises and avoid duplicate movement
  patterns when metadata permits.
- Available equipment and exercise difficulty filter results.
- Every recommendation references an existing exercise slug.

The current seed data records primary muscle reliably. Secondary-muscle data is
optional, so missing secondary mappings must degrade gracefully.

### AI regeneration

AI regeneration is explicitly user-triggered. The backend receives the selected
muscle, goal, level, available equipment and the allowed exercise catalog. Its
strict Pydantic output contains only known exercise slugs, sets, rep or duration
targets, rest and rationale. Invalid or unknown exercises reject the response.

Failure never removes deterministic suggestions. The user sees the existing
recommendations and a concise retry message.

## Data and API Design

The existing `GET /api/muscle-heatmap` response remains backward compatible:

```json
{
  "volumes": { "chest": 3200 },
  "max": 4500,
  "muscles": {
    "chest": {
      "sets_7d": 14,
      "load_percent": 71,
      "last_trained_at": "2026-09-01T10:00:00Z",
      "recovery_state": "recovering"
    }
  }
}
```

`volumes` and `max` remain required. `muscles` is additive so existing clients
continue working.

`GET /api/muscles/{slug}/recommendations` returns deterministic primary and
secondary exercises plus combinations and circuits. Query parameters may
include level and equipment.

`POST /api/coach/muscle-circuit` performs optional AI regeneration. It uses the
existing authenticated AI infrastructure and strict JSON validation.

All history endpoints enforce the existing owner-or-active-coach authorization
rule. Exercise catalog data remains publicly readable as it is today.

## Component Boundaries

Planned frontend responsibilities:

- `app/muscles.tsx`: route composition and server data loading.
- `components/anatomy/muscle-explorer.tsx`: selected view, muscle and mode.
- `components/anatomy/anatomy-body.tsx`: shared SVG shell and path rendering.
- `components/anatomy/front-muscles.tsx`: original front muscle paths.
- `components/anatomy/back-muscles.tsx`: original back muscle paths.
- `components/anatomy/muscle-region.tsx`: press, color and animation behavior.
- `components/anatomy/muscle-detail-sheet.tsx`: overview, exercises and circuits.
- `components/anatomy/muscle-types.ts`: slugs, sides and activation types.
- `components/anatomy/recommendations.ts`: deterministic client presentation.

`muscle-heatmap.tsx` remains as a backward-compatible compact wrapper around the
new body component.

Planned backend responsibility:

- `routers/muscles.py`: heatmap enrichment, deterministic recommendations and
  AI circuit endpoint.
- `server.py`: include the new router and preserve the current route.

No new frontend dependency is required. The design uses the existing
`react-native-svg`, React Native animation capabilities and installed
Reanimated package.

## Error Handling and Performance

- Unknown muscle slugs return 404.
- Empty history returns neutral load and recovery states.
- Catalog or recommendation failure leaves the body fully interactive.
- AI timeouts do not block deterministic recommendations.
- SVG path definitions are static and memoized.
- Only selected and activated regions update during interaction.
- The Home preview disables expensive fiber animation.
- Animations pause when the screen loses focus.
- Body rendering targets smooth interaction on mid-range Android devices.

## Accessibility

- Every region has a button role and a label such as “Chest, high weekly load.”
- Front/Back controls expose selected state.
- Color states include text labels and outlines.
- Touch targets extend beyond narrow SVG paths without changing appearance.
- Reduced-motion preferences disable movement and preserve state changes.
- Detail-sheet controls follow a predictable focus order.

## Testing and Acceptance Criteria

Backend tests verify:

- The old `volumes` and `max` fields remain unchanged.
- Enriched muscle statistics are calculated from seven-day workout history.
- Cross-user access remains forbidden.
- Recommendations contain only catalog exercises.
- AI responses reject unknown slugs and out-of-range prescriptions.

Frontend verification covers:

- Front and back render at phone and web widths.
- Every supported region can be selected.
- Swipe and segmented controls stay synchronized.
- Selection updates the detail sheet.
- Primary and secondary exercise activation use different intensities.
- Reduced-motion mode avoids animated movement.
- Empty, loading, offline and AI-error states remain usable.
- The compact Home card still renders and opens the explorer.

Success means the body is recognizably anatomical at a glance, all 14 represented
muscle groups are interactive, existing heatmap behavior remains intact, and a
user can move from muscle selection to a valid exercise combination or circuit
without encountering a dead end.

## Sources and Inspiration

- TenXRep: interactive muscle activation, volume and balance views.
- Muscle & Motion: detailed anatomical presentation and primary/secondary
  activation.
- MyMuscle: body-level training-load and recovery feedback.

These products inform interaction patterns only. IronFlow artwork, layout and
implementation remain original.
