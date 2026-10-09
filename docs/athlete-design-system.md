# IronFlow Motion — member design system

Direction: **IRONFLOW MOTION — Athletic Intelligence**. Premium, human, energetic, and data-aware. The ground stays charcoal `#101418`. The action color stays chartreuse `#D6E35A`. The staff console keeps Precision Performance and does not use this document.

## Principles

- Chartreuse is the primary action and the selected tab.
- Data cards are flat, with a real border. The session hero and sheets are the raised layer.
- Unknown is not zero. A measured zero is labeled. Sample data is never labeled live.
- Motion is a short fade (180ms). Reduced motion removes it. Nothing loops for decoration.
- Imagery is for people and places (community, coaches, onboarding). The logger, labs, and charts stay quiet.
- Readiness and lab copy are training guidance or education. They are not a diagnosis.

## Canonical tokens

Member colors live in `frontend/src/palette.ts` and are re-exported from `frontend/src/theme.ts`.

| Role | Token | Hex |
|---|---|---|
| Ground | `bg` | `#101418` |
| Card | `surface` | `#1A1F24` |
| Raised fill | `surface2` | `#242A31` |
| Skeleton | `surface3` | `#2E3842` |
| Hairline | `border` | `#3A4652` |
| Strong hairline | `borderStrong` | `#52606C` |
| Primary text | `text` | `#F2F3F4` |
| Secondary text | `textMuted` | `#C5CCD3` |
| Tertiary text | `textDim` | `#A8B2BC` |
| Action | `brand` / `brandOn` | `#D6E35A` / `#16180C` |
| Small success / warning / error / info | `successText`, `warningText`, `errorText`, `infoText` | `#8FE0B5`, `#F0D59A`, `#FFB4AE`, `#C9E2F8` |

`success`, `warning`, `error`, `info`, `blaze`, and `volt` are strokes and dots. They are not body copy. `textDim` clears 4.5:1 on `bg`, `surface`, `surface2`, and `surface3`. The old `#6E767E` did not (about 4.01:1 on `#101418` and 3.60:1 on `#1A1F24`).

Spacing (`4, 8, 12, 16, 24, 32, 48`) and radius (`8, 12, 16, pill`) stay numeric-identical because the staff console still imports them.

## Typography

Bundled SIL Open Font License files in `frontend/assets/fonts`:

- Display: Barlow Condensed (`IronflowDisplay`, `IronflowDisplayStrong`)
- Body: Barlow (`IronflowText`, `IronflowTextStrong`)
- Numbers: Space Mono (`IronflowNumeric`)

Satoshi is not licensed in this repo. Inter is no longer loaded from Google Fonts. If a face fails to load, web falls back to `system-ui`.

## Elevation, motion, imagery

- `card` is flat. `raised("card")` is the session hero. `raised("float")` is available for sheets.
- Stack transition is a 180ms fade, or `none` when reduced motion is on.
- `ReliableImage` (`expo-image`, memory-disk cache) replaces remote avatars and post photos and shows a local placeholder on failure.
- The session hero uses one static `expo-linear-gradient` wash from `#243018` to the card surface. No glass, no WebGL, no Lottie, no Rive.

## Status language

`frontend/src/metric-state.ts` is the reader for wearable points and readiness.

| State | What the member sees |
|---|---|
| Missing point, no wearable | Not connected, figure `—` |
| Missing point, wearable connected | Not measured, figure `—` |
| Numeric zero | Recorded zero, figure `0` |
| Readiness score null | Unknown, plus the missing input names |
| Readiness object absent | Today's score was not returned |
| Readiness score present, including 0 | The score, a push / steady / rest label, and a non-medical caption |
| Source mode `simulated` | Sample data. This is not a live reading. |
| Lab screen | Educational banner. Reference range is not a diagnosis. |
| Trend gap | Not measured. A gap is not drawn as zero. |

## Staff isolation

`frontend/src/components/admin/*` color imports use `staffColors`. Staff still reads `spacing` and `radius` from `theme.ts`. Do not point staff at `palette.ts`.
