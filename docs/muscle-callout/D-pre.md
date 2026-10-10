# Bot D — Pre-implementation challenge

Independent review of the audit and the visual proposal before any UI is built. Measurements below come from sampling every interactive path in `anatomy-artwork.ts` (curves and arcs expanded, not the raw `labelX` / `labelY` pairs).

## Anchor accuracy — challenged

`labelX` / `labelY` fail as centers. Several are path-start corners (`biceps` label is outside its own sampled box). A mean of left and right centroids is inside the union box and still in the sternum / spine gap, so a leader from that point does not start on the muscle.

Required rule: the anchor must lie inside the union box **and** inside at least one member fill. Grid-search an interior point; do not publish the midline average when it fails a fill test.

## Leader crossings — challenged

A horizontal ray from the lateral centroid to the gutter crosses other muscles for chest (shoulders), abs (biceps and obliques), obliques (forearms), upper back (lats and rear delts), and lower back (forearms). A single elbow at the anchor x clears every slug except abs. Abs has one clear exit, near y = 665 on its own lateral edge, and the anchor must move to that interior point rather than travel across the obliques.

Lats and lower back only clear if the elbow may leave the muscle box through empty space (sampled points must miss every other slug's fill). A long lats dogleg (about 230 units) is acceptable only if that clearance test passes. Grazing a neighbor is a failure.

"No crossings" during rapid changes is a second constraint: never two leaders mounted. The outgoing dash must finish or be cancelled before the next polyline is shown.

## Rotation — challenged

Front and back yaw are counter-phased (`-18°…18°` vs `18°…-18°`). A label outside both transforms will detach as soon as either figure is off identity. Pausing the spin flag is not enough while the 350ms settle is running.

The leader has to be a child of the yaw view. On a wide layout the gutter label is in that same view. On a narrow layout the text sits under both figures, so it may appear only once yaw is back to 0° (the 320ms line draw covers a 200ms settle). Snapping yaw by toggling `spinning` without placing the line in the transformed layer is a fail.

## Overlap — challenged

Seven front slugs cannot each own a three-line label stacked in one gutter without large vertical shifts. Alternating gutters plus a short edge segment (still outside every fill) is the way to keep slots exclusive without dragging the label to the feet. Slots must be tested as rectangles, not as "only one is visible so overlap is fine." If the reserved slot is shorter than the painted text block, that is an issue to record, not to hide.

## Accessibility — challenged

Deleting the columns and chips deletes the only keyboard path. Web regions currently do not take `onPress` (the container click owns taps). Focusable paths plus Enter / Space, and a live region for name, role, and frequency, are mandatory. Hover is not a selection mode.

## Reduced motion — challenged

`AccessibilityInfo` on web follows `prefers-reduced-motion`. The callout must not leave a dash offset in progress when that setting is on. Timers from the previous slug must clear.

## Verdict before build

Do not implement the midline anchor or a screen-space leader. The plan in `E-plan.md` is the one that answers these objections. If the clearance test cannot find a route for any slug, stop and report that slug rather than drawing through a neighbor.
