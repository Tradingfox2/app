# Bot B — Hierarchy, placement, motion, narrow screens

## Hierarchy

The figure stays dominant. The callout is a margin annotation, not a card.

- Leader: 1.25px non-scaling stroke in `colors.brand` (chartreuse `#D6E35A`), round caps, no glow, no fill panel.
- A 4px terminal at the anchor so the origin reads as part of the region.
- Name: `fonts.display` (Barlow Condensed / Ironflow Display), 20px desktop / 18px compact, `colors.text`.
- Role: `fonts.text`, 13px, `colors.textMuted`, up to 3 lines.
- Sessions and hard sets: `fonts.numeric` (Space Mono / Ironflow Numeric), 12px. Sessions use `colors.brand`. Sets use `colors.text` so chartreuse stays on the selection line and the frequency figure.
- No surface fill, no shadow, no border card. A 16px brand tick sits at the label's inner edge, meeting the leader.

## Placement

Coordinates stay in the body's viewBox (`0 0 724 1448` front, `724 0 724 1448` back). The leader is a second SVG stacked on `AnatomyBody` with the same viewBox, inside the yaw transform (`perspective` + `rotateY` in `MuscleHeatmap`). Screen-fixed lines are rejected: the yaw would point them off the muscle.

The label sits in a gutter column just outside the SVG, in that same transformed row, vertically centered on the leader's end. Wide stage (≥ 760px): gutter 176px. The body width cap can rise slightly once the old 148px label columns are gone, but it stays under the stage.

Front and back each compute their own plan. Shoulders and forearms therefore get a callout on the emphasized side only, never two at once.

## Sequence

Tuned next to IronFlow Motion (`theme.motion` is 140 / 180 / 240). A drawn leader needs to stay inside the requested 250–450ms window, so it is longer than `motion.slow` and is not written back onto the global tokens.

| Step | Duration | Curve |
| --- | --- | --- |
| Outgoing callout (opacity and dash together) | 120ms | ease out |
| Leader draw | 320ms | cubic out |
| Name fade | 140ms, starts when the line finishes | ease out |
| Role fade | 140ms, 90ms after the name | ease out |
| Sessions and sets fade | 140ms, 90ms after the role | ease out |

Reduced motion: dash and opacities snap to the settled state. No draw and no slide. Yaw while a callout is up eases back to 0° in 200ms (inside the line draw). Text is still at opacity 0 until 320ms, so the label appears after the figure is frontal.

## Narrow screens

Under 760px the desktop gutter is not used. The same leader still runs to the figure's side edge (it stays attached to the region). The readable block is a full-width compact stack under the pair: name, role, sessions, sets. It is not an absolute desktop label shrunk until it clips. The block fades on the same schedule, which starts after yaw has returned, so a label outside the two counter-rotating figures does not detach from a moving line end.

## What does not move

Home heatmap sizing, legend, spin control, detail sheet chrome, and fiber highlight stay. No auto-cycle, no extra 3D, no new typeface files.
