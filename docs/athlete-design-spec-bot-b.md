# Night Studio — member design spec

Status: proposal for the member app. This document does not change application code. The staff console stays on Precision Performance (`staffColors` in `frontend/src/components/admin/staff-theme.ts`). Spacing and radius numbers in `frontend/src/theme.ts` stay shared with staff and do not move.

The shipped first pass is **IRONFLOW MOTION** (`docs/athlete-design-system.md`, `design_guidelines.json`, `frontend/src/palette.ts`). Its materials are right: charcoal ground, chartreuse only for action and selection, bundled OFL type, honest numbers. Its home still stacks similar cards, so it reads as a dashboard. Night Studio keeps those materials and changes the composition.

Visual references, rendered with Playwright from the HTML in this folder’s sibling `docs/design-refs/`:

| File | What it shows |
|---|---|
| `docs/design-refs/board.png` | The three directions at phone size |
| `docs/design-refs/home-phone.png` | Recommended home |
| `docs/design-refs/home-desktop.png` | The same home when the window is wide |
| `docs/design-refs/library.png` | Exercise posters and demos |
| `docs/design-refs/coach.png` | AI coach thread |
| `docs/design-refs/logger.png` | Set logger, kept quiet |
| `docs/design-refs/charts.png` | Chart strokes and the SVG body |

Source HTML and original SVG stand-ins live beside the PNGs. Re-render with `node docs/design-refs/render.mjs` after `playwright` is installed and `CHROME_PATH` points at a Chrome binary. No remote images are loaded.

## 1. Three directions

**Night Studio.** The session is a photographic stage under a charcoal scrim. Numbers sit in a quiet ledger. The coach speaks from a portrait.

**Field Ledger.** An editorial training book. Condensed type and ruled rows carry the energy. Photography stays in the library filmstrip.

**Body Atlas.** The SVG body is the week’s chart. The coach stands beside the load. One chartreuse action starts the session. There is no 3D model.

## 2. Recommendation

Build **Night Studio**.

The member’s first job on home is to start today’s session, and the product’s human difference is the coach plus exercise posters and planned demo videos. Night Studio spends photography on those three jobs and leaves labs, charts, and the logger as type.

Field Ledger is the calmest book and the easiest screen to scan, and it wastes the photographs the product is commissioning. It is the right fallback if a photo set is not licensed: drop the stage image, keep the scrim color as a flat `brandWash`, and keep every other Night Studio rule.

Body Atlas makes the diagram the brand. The approved anatomy spec (`docs/superpowers/specs/2026-09-01-interactive-anatomical-muscle-explorer-design.md`) already puts the large body on `/muscles` and a compact preview on home. Promoting the body to the home hero slows “start the session” and fights that decision. The diagram stays in the product. It does not become the identity.

Night Studio is not a Whoop dial wall, a Strava map, or a Nike Training Club poster grid. One photograph is on screen at a time on home. Chartreuse appears on the start control and the selected tab. Nothing glows.

## 3. Principles

1. The ground stays dark. `#101418` is the member and staff ground. Do not introduce a second black.
2. Chartreuse `#D6E35A` is the primary action and the selected state. It is not a heading color, a link color, a chart default, a muscle fill, or a glow.
3. Unknown is not zero. A measured zero is labeled. Sample data is never labeled live. Readiness and lab copy are training guidance or education, not a diagnosis. `frontend/src/metric-state.ts` remains the reader.
4. One raised surface: the session stage, and sheets. Data rows stay flat, with a border and space, not a shadow.
5. Motion is short and finite. Reduced motion removes it. Nothing loops as decoration.
6. The AI coach and a human coach partner are different people. The persona photograph is only the AI coach. `/coach/onboarding` is an application form and does not wear her portrait.
7. Staff screens do not import `palette.ts` and do not receive Night Studio photography, stage cards, or new member tokens.

## 4. Tokens

Canonical member color today is `frontend/src/palette.ts`, re-exported by `theme.ts`. Night Studio keeps every existing token. It adds two member-only tokens when someone implements this spec. Staff does not receive them.

### 4.1 Color

| Role | Token | Hex | Where |
|---|---|---|---|
| Ground | `bg` | `#101418` | Screen |
| Card | `surface` | `#1A1F24` | Ledger cards, tab bar |
| Raised fill | `surface2` | `#242A31` | Inputs, user chat bubble, week cells |
| Skeleton | `surface3` | `#2E3842` | Skeleton, poster fallback |
| Hairline | `border` | `#3A4652` | Card and row edges |
| Strong hairline | `borderStrong` | `#52606C` | Inputs, tab bar top |
| Identifiable edge | `edge` (new) | `#6E7C8A` | Strokes that must be seen on their own: chart focus, demo control outline |
| Primary text | `text` | `#F2F3F4` | Body, stage title |
| Secondary text | `textMuted` | `#C5CCD3` | Eyebrows, captions, inactive tabs |
| Tertiary text | `textDim` | `#A8B2BC` | Hints, placeholders |
| Hero figure | `hero` | `#FFFFFF` | The single largest number on a screen, if it is not a Space Mono metric on `text` |
| Action | `brand` | `#D6E35A` | Primary button fill, selected tab, selected chip fill, selected chart series |
| On action | `brandOn` | `#16180C` | Label on `brand` |
| Stage wash | `brandWash` | `#243018` | Top of the stage scrim, mixed into the photo, not a full-screen tint |
| Letterbox | (literal) | `#000000` | Video well only. Already used by `VideoView` |
| Success mark | `success` | `#3D9A6A` | Dots, strokes, anatomy “productive” |
| Success words | `successText` | `#8FE0B5` | Small copy |
| Warning mark | `warning` | `#C4A15A` | Dots, strokes, anatomy “high” |
| Warning words | `warningText` | `#F0D59A` | Small copy |
| Error mark | `error` | `#E23B3B` | Icons, strokes, anatomy “overreaching” |
| Error words | `errorText` | `#FFB4AE` | Small copy, including coach send failures |
| Info mark | `info` | `#7AA2C9` | Dots, strokes, anatomy “low” |
| Info words | `infoText` | `#C9E2F8` | Small copy |
| Live dot | `live` | `#E23B3B` | Recording and live-room presence |
| Personal record | `pr` | `#E4B15A` | A mark beside a record, plus the words “Personal record” |

`volt` (`#B6F13A`) and `blaze` (`#FF8A00`) stay in the file so existing call sites compile. Night Studio does not use them for new UI. They read as a second neon next to chartreuse. Load, strain, and activation use the success / warning / info marks plus a word.

`edge` is not a text color. `textDim` already clears body-text contrast. `#6E7C8A` is close to the staff `textDim` (`#6E767E`) and must not be copied into `staffColors`.

### 4.2 Contrast

Ratios are WCAG 2.x relative luminance, lighter+0.05 over darker+0.05. Text needs 4.5:1. A control boundary or icon that is the only way to see the control needs 3:1. Large display type (24px regular or 18.5px bold and up) needs 3:1; Night Studio still aims at 4.5:1 for it.

Text pairs that pass 4.5:1:

| Foreground | Background | Ratio |
|---|---|---|
| `text #F2F3F4` | `bg #101418` | 16.65 |
| `text` | `surface #1A1F24` | 14.94 |
| `text` | `surface2 #242A31` | 13.03 |
| `text` | `surface3 #2E3842` | 10.74 |
| `textMuted #C5CCD3` | `bg` | 11.41 |
| `textMuted` | `surface` | 10.24 |
| `textMuted` | `surface2` | 8.93 |
| `textMuted` | `surface3` | 7.36 |
| `textDim #A8B2BC` | `bg` | 8.60 |
| `textDim` | `surface` | 7.71 |
| `textDim` | `surface2` | 6.73 |
| `textDim` | `surface3` | 5.54 |
| `hero #FFFFFF` | `bg` | 18.50 |
| `brandOn #16180C` | `brand #D6E35A` | 12.81 |
| `errorText #FFB4AE` | `bg` | 10.92 |
| `errorText` | `surface` | 9.79 |
| `errorText` | `errorWash #3A1818` | 9.36 |
| `successText #8FE0B5` | `bg` | 11.89 |
| `successText` | `surface` | 10.67 |
| `warningText #F0D59A` | `bg` | 12.94 |
| `warningText` | `warningWash #3A3118` | 9.00 |
| `infoText #C9E2F8` | `bg` | 13.84 |
| `infoText` | `surface` | 12.42 |

`brand` on `bg` is 13.21, on `surface` 11.85, on `surface2` 10.34. Selected tab labels in chartreuse pass. Do it anyway only for selection and the rare text button that is the primary action sitting on the brand fill. Do not set body copy in chartreuse. `text` on `brand` is 1.26:1 and fails. Labels on a brand fill use `brandOn` only.

Marks, not small sentences:

| Mark | On `bg` | Use |
|---|---|---|
| `success #3D9A6A` | 5.31 | Stroke or dot. Words use `successText`. |
| `warning #C4A15A` | 7.57 | Stroke or dot. Words use `warningText`. |
| `error #E23B3B` | 4.34 | Icon or stroke. Fails 4.5:1 as small text. Words use `errorText`. The coach thread’s current `colors.error` sentence is the case to correct. |
| `info #7AA2C9` | 6.90 | Stroke or dot. Words use `infoText`. |
| `edge #6E7C8A` | 4.33 on `bg`, 3.88 on `surface`, 3.39 on `surface2` | Non-text boundary only. |

These do not pass 3:1 and must not be the only sign of a control:

| Pair | Ratio | What to do |
|---|---|---|
| `border` on `bg` | 1.92 | Pair the line with a surface fill and 12–16px of separation. |
| `border` on `surface` | 1.72 | Same. A nested line inside a card is not enough on its own. |
| `borderStrong` on `bg` | 2.86 | Inputs also change fill to `surface2`. Focus adds a 2px `text` ring. |
| `borderStrong` on `surface` | 2.57 | Same. |
| `surface` on `bg` | 1.11 | Cards need the hairline plus padding. Do not rely on the fill step alone. |
| `brandWash` on `bg` | 1.33 | The wash is atmosphere inside the stage, under a photograph. It is not a button. |

`brandHover` `#D9E567` (already in `press-feedback.ts`) on `bg` is 13.52. Hover lightens the brand fill by that mix. It does not add a glow.

### 4.3 Typography

Bundled SIL Open Font License files in `frontend/assets/fonts`. Do not load faces from a CDN.

| Role | Family | Token | Size / line | Weight | Tracking |
|---|---|---|---|---|---|
| Stage title | Barlow Condensed | new `type.stage` | 40 / 40 | 700 | 0.2 |
| Screen title | Barlow Condensed | `type.screenTitle` | 32 / 36 | 600 | 0.2 |
| Section | Barlow | `type.section` | 16 / 22 | 600 | 0 |
| Body | Barlow | `type.body` | 16 / 24 | 400 | 0 |
| Button | Barlow | `type.button` | 15 / 20 | 600 | 0.2 |
| Caption | Barlow | `type.caption` | 13 / 18 | 400 | 0 |
| Eyebrow | Barlow | `type.eyebrow` | 12 / 16 | 600 | 0.6, uppercase |
| Metric | Space Mono | `type.metric` | 26–28 | 400 | −0.3, tabular nums |
| Hero figure | Space Mono | `type.hero` | 28–32 | 400 | −0.4 |

Files on disk: `Barlow-Regular.ttf`, `Barlow-SemiBold.ttf`, `Barlow-Bold.ttf`, `BarlowCondensed-SemiBold.ttf`, `BarlowCondensed-Bold.ttf`, `SpaceMono-Regular.ttf`, plus `OFL.txt` for Barlow. Space Mono is the OFL face from Colophon Foundry; keep that notice with the file if the set is redistributed. There is no Space Mono bold in the repo. Do not synthesize one with a stroke. Emphasis on a number is size, not a fake bold.

Satoshi is a commercial Fontshare face and is not licensed here. Inter is not loaded. Web fallback in `theme.ts` stays `system-ui` for text and `ui-monospace` for figures if a face fails.

Eyebrows are the only uppercase text style, plus button labels that are already short verbs (`Start day`, `Log set`, `Send`). Sentences from the coach are sentence case.

Tab labels are 12px, weight 600. The current 10px label is too small for a primary destination even though `textMuted` on `surface` passes contrast.

### 4.4 Space, radius, hit area

Do not change the numeric scale. Staff layout imports it.

| Token | px |
|---|---|
| `spacing.xs` | 4 |
| `spacing.sm` | 8 |
| `spacing.md` | 12 |
| `spacing.lg` | 16 |
| `spacing.xl` | 24 |
| `spacing.xxl` | 32 |
| `spacing.xxxl` | 48 |
| `radius.sm` | 8 |
| `radius.md` | 12 |
| `radius.lg` | 16 |
| `radius.pill` | 999 |

Screen margin is `lg` (16). Gap between stacked regions is `md` (12). Inside a ledger card, group with `sm` (8) and pad with `lg`. Primary controls are at least 48px tall. Icon buttons and tab items are at least 44×44. `hitSlop` stays `{ top: 10, bottom: 10, left: 10, right: 10 }`.

### 4.5 Depth

| Layer | Spec | Shadow |
|---|---|---|
| Ground | `bg` | none |
| Ledger card | `card` from `theme.ts`: `surface`, 1px `border`, radius `lg` | none |
| Bleed row | `bleedRow`: full width, bottom hairline, no radius | none |
| Stage | Photo or `brandWash`, scrim, radius `lg`, `raised("card")` | web `0 10px 28px rgba(0,0,0,0.28)`; native offset `(0, 6)`, opacity 0.22, radius 10, elevation 3 |
| Sheet | Solid `surface`, `raised("float")` | web `0 16px 40px rgba(0,0,0,0.45)`; native offset `(0, 10)`, opacity 0.35, radius 16, elevation 8 |

Shadows are black and soft. They are not colored and they are not a glow. One stage per screen. A wide home keeps that one stage and places the ledger beside it. It does not become four equal cards.

### 4.6 Motion

Durations already in `theme.ts`: `fast` 140, `base` 180, `slow` 240. Easing stays the existing ease. `prefers-reduced-motion` and the app’s reduced-motion flag set duration to 0 and skip scale.

| Event | Motion |
|---|---|
| Stack push | 180ms fade. No travel when reduced motion is on. |
| Press, primary | Existing `press-feedback.ts`. Brand fill moves to `brandHover`. No scale when reduced motion is on. |
| Press, other | Hairline or surface lift. Chartreuse does not appear on a quiet control. |
| Sheet | `@gorhom/bottom-sheet` present / dismiss. Reduced motion cuts the spring to a cut. |
| Rest timer | Number updates. No pulsing ring. |
| Haptics | `expo-haptics` on a logged set and when rest completes. Not on tab changes, not on scrolling. |
| Home muscle preview | `spinning={false}`. The 8s yaw in `MuscleHeatmap` is decoration. Reduced motion already stops it; Night Studio stops it for everyone on home. |
| Video | No autoplay. Poster until the member presses play. |
| Skeleton | A static `surface3` block. No shimmer loop. |

Do not add Lottie, Rive, or a looping Reanimated sequence.

## 5. Imagery, video, gradient, shadow, SVG, 3D

| Medium | Where it helps | Where it hurts | Decision |
|---|---|---|---|
| Photograph | Session stage (one), exercise poster, AI coach portrait, onboarding scrim, member posts and avatars | Logger fields, labs, charts, sources, settings, the human-coach application | Use `expo-image` through `ReliableImage`. Local placeholder on failure. |
| Video | Exercise demo, community posts that are videos | Home background, stage autoplay, loader | `expo-video` is already a dependency. Letterbox on `#000`, `contentFit="contain"`, native controls, poster frame, no autoplay. |
| Gradient | Charcoal scrim so type stays readable on a photo. Auth uses the same scrim. | Data cards, charts, glass, animated mesh | One static `expo-linear-gradient`. No second gradient on the page. |
| Shadow | Stage and sheets, so the member can tell what is in front | Every card, colored glow | Keep `raised("card")` and `raised("float")` only. |
| SVG anatomy | Home preview and `/muscles`. Load is a tint plus a word. Selection is an outline. | A rotating mascot, a chartreuse body, a gendered diagram | Keep `react-native-svg` and `anatomy-artwork.ts`. |
| 3D | Nothing in this product. The approved anatomy direction is 2.5D SVG: layered fills, fiber strokes, tendon highlights. | A WebGL body would add a runtime, a second art pipeline, and a weaker phone. | Do not add Three.js, expo-gl, or a model. |

`expo-blur` and the platform note for `expo-glass-effect` stay unused on member surfaces. Blur makes numbers harder to trust. The scrim is a gradient, not a blur. Sheets are solid `surface`.

The neon texture and the male-athlete stock URLs in `design_guidelines.json` `images` are not Night Studio assets. Do not ship them as the coach or the stage.

### 5.1 Commissioning brief

Production photographs are owned by the product (work for hire or a written license that allows the app to ship them). The SVG files in `docs/design-refs/` are original stand-ins for this spec. They are not the brand photography.

AI coach, when a photograph is commissioned:

- An adult athletic Black woman with a light complexion.
- Athletic wear that reads as training kit: a crew or modest training top, training shorts or leggings, training shoes. The body is covered enough that the picture is about coaching, not a pose.
- Standing or mid-instruction, face visible, expression competent and calm. Full figure or head and shoulders. No chest-first crop, no arched pose, no wet look, no lingerie.
- Gym light is practical and warm, not a neon rim and not a ring light glamour setup.
- Alt text describes the role: “Coach, ready for today’s session.” It does not describe her body.

Exercise posters, one per exercise slug:

- The movement is the subject. Athletic wear appropriate to the lift. Face optional. Full body in frame when the lift needs the whole body to be understood.
- Neutral gym. No brand logos that are not IronFlow’s.
- Fallback if the file is missing: a `surface3` block with the exercise name. Never a broken remote image, never a sexualized substitute.

Demo videos, when they exist:

- Same wardrobe and framing rules as the poster. The poster is the still until play.
- Captions when a caption file exists. Sound stays off until play.
- Reduced motion does not autoplay and does not animate the poster.

Member community photos are member content. The design does not regrade them. Moderation rules stay as they are.

### 5.2 Anatomy color, retokened

Current load fills in `muscle-region.tsx` (`#2A3140`, `#0E7490`, `#15803D`, `#C2410C`, `#BE123C`) and the Material dots in `muscle-detail-sheet.tsx` (`#4CAF50`, `#FF9800`, `#F44336`, `#9E9E9E`) sit outside the member palette and add a second rainbow. Map them onto marks the member already learns, and always print the word.

| Load state | Fill | Word |
|---|---|---|
| Untrained, including a true zero volume | `#8C5A56` | No recent activity |
| Low, under 35% | `#7AA2C9` (`info`) | Light load |
| Productive, 35% up to 70% | `#3D9A6A` (`success`) | Productive load |
| High, 70% up to 85% | `#C4A15A` (`warning`) | High load |
| Overreaching, 85% and up | `#E23B3B` (`error`) | Overreaching |

`#8C5A56` is a muted anatomical mark, 3.27:1 on `bg`. It is not text. `surface3` is only 1.39:1 on `surface`, so an untrained body drawn in the card fill disappears. Sit the diagram on a `bg` plate inside the card. Thresholds stay the ones in `loadState`. Chartreuse is not a fill. The selected region gets a 2px `text` outline and the existing label. Activation: primary `text`, secondary `textMuted`, stabilizer `warning`. Do not use `volt` or `blaze` on the body.

The artwork credit in `anatomy-artwork.ts` stays: paths adapted from react-native-body-highlighter (MIT). Do not replace them with a traced copy of the owner’s reference image. The diagram body stays neutral and unlabeled by gender. The coach photograph is a person. The diagram is not her.

Home copy stays honest: the tint is a share of logged volume, not a scan.

## 6. Component specs

Measurements use the tokens above. Test IDs named here already exist. An implementation keeps them.

### Stage

The session hero. Replaces the flat gradient card at `today-card`.

- Radius `lg`, `raised("card")`, margin horizontal `lg`.
- Media: `expo-image`, cover, the day’s exercise poster when the plan names a first exercise. Otherwise the coach photograph. If neither file is local, fill with `brandWash` to `surface` and do not invent a remote URL.
- Scrim, `expo-linear-gradient`, bottom to top: `#101418` at the bottom, transparent by about 30% of the height. Type sits on the opaque end.
- Eyebrow “Today’s session”, stage title (the session name or “Lower body” style focus), one caption line (week, day, focus, exercise count).
- One brand button: Resume, Start day, or Generate plan. The existing test IDs stay: `start-workout-cta`, `today-start-day`, `today-generate`.
- Quiet text button under it for Start empty (`today-start-empty` or `start-workout-cta` when that is the only start, matching today’s branching).
- Minimum media height 280. On a short phone the title and the brand button must remain on screen without covering each other. The scrim is what keeps the title at 16.65:1, not a text shadow.

### Ledger card

`card`. Eyebrow in `textMuted`. Figures in Space Mono. Captions in `textMuted` or `textDim` for the state line (Not connected, Not measured, Recorded zero, Measured, Sample data). No shadow, no photo, no chartreuse fill.

### Meter row

Replaces the three dashboard dials as the visual, and keeps `ring-load`, `ring-strain`, `ring-recovery`, `ring-sleep` on the same three measures so tests can find them.

- Columns: 92px name, 2px track, figure.
- Track is `borderStrong`. The measured fill is `text`, not `blaze` / `success` / `info`. Color is not the status. The caption is the status.
- Unknown: figure `—`, empty track, caption “Not connected” or “Not measured”.
- Recorded zero: figure `0`, empty or full according to the real value, caption “Recorded zero”.
- A 2px rule does not need a 3:1 rainbow. The figure and the caption carry the information. `ActivityRing` can remain for the outdoor activity day, where it is one effort, not a trio of brand dials. Its arc stays the caller’s mark color. Chartreuse is still not a ring color.

### Coach line

`coach-tip-card` / `coach-tip-open`.

- Flat ledger row, min height 72, portrait 48px circle, eyebrow “Coach”, one sentence, chevron.
- Portrait is the AI coach. Offline: a `warning` icon and the words “AI offline” in `warningText`. Do not gray the whole row into unreadability.
- Press opens `/coach/chat`.

### Poster tile

Library only.

- Radius `lg`, border, image 4:5 or a 168-tall crop, name in 15/20 semibold, muscle and equipment in caption.
- “Play demo” is an outline button using `edge`, not a brand button. The brand button on this screen is the existing new-session action.
- Missing poster: `surface3` and the name.

### Demo frame

`exercise-demo-modal` and community video.

- Well `#000`. Poster until play. `VideoView` native controls, contain.
- Close control 44×44, `text` on the well, with a solid `surface` chip behind the icon so it clears 3:1 on a bright frame.
- No looping preview on the tile.

### Buttons

- Primary: brand fill, `brandOn` label, radius `sm`, min height 48, horizontal padding `lg`. One primary per region.
- Quiet: no fill, `text` label, min height 44.
- Disabled: opacity 0.45, and `accessibilityState.disabled`. Do not switch a disabled primary to gray text on brand; the opacity treatment is already in the coach composer and it keeps the fill recognizable.
- Focus: 2px `text` outline, 2px offset. Focus is not chartreuse, so a focused quiet button is not mistaken for the selected chip.

### Chips and tabs

- Unselected chip: transparent, 1px `border`, `text` label, height 36 inside a 44px hit target.
- Selected chip: brand fill, `brandOn` label. One selected chip in a group.
- Tab bar: `surface` bar, 1px `borderStrong` top, height 68 (84 on iOS with the home inset, as today). Active tint `brand`. Inactive `textMuted`. Icon 22. Label 12. Badge stays `text` on `bg`.

### Sheet

Solid `surface`, radius `lg` on the top corners, `raised("float")`, grabber in `edge` (3×1, the grabber is not the only affordance: the title is). Muscle detail, merge session, and report sheets use this. No blur behind the numbers. A dim overlay `rgba(16,20,24,0.72)` is enough to mark the scrim; the sheet’s own fill is opaque.

### Chart

- Plot on `surface`. Gridlines `border` at 1px. They are guides. The series does the talking.
- Default series: 2px `text`. No area glow. An optional 8% `text` fill under the line is allowed and must not be chartreuse.
- Selected series: 2px `brand`.
- Gap: the path breaks. Caption “Not measured” in `textDim`. Do not drop the line to zero.
- Points are optional 4px `text` dots. A selected point may be `brand`.
- Thresholds, when a lab marker has a reference band, use `success` / `warning` / `error` as a 1px stroke plus the words in the `*Text` colors. The banner on labs stays educational.
- Do not draw a ring, a gauge, or a gradient mesh in place of this line.

### Inputs

- Min height 48, radius `sm`, fill `surface2`, 1px `borderStrong`, text `text`, placeholder `textDim`.
- Focus: border becomes `text`.
- Error: 1px `error` border (the stroke passes as a mark) and the sentence in `errorText`.

### Skeleton, empty, error

- Skeleton: `surface3` blocks in the shape of the stage title and three meter rows. `accessibilityLabel` “Loading home”. No shimmer.
- Empty: one sentence in `text` and, if there is an action, one brand button. No illustration set.
- Error: `errorText` sentence, `accessibilityRole="alert"`, a quiet Retry control. Icon may use `error` or `live`.

## 7. Per-route guidance

Inherit tokens everywhere the screen already uses `theme.ts`. The notes below are the compositional changes. Flows and test IDs stay.

### Home `(tabs)/home`

Order, top to bottom:

1. Greeting eyebrow, name in screen title, search / messages / notifications. The week-count block can sit in the ledger, not as a second hero.
2. Stage (`today-card`) with the one brand start.
3. Coach line (`coach-tip-card`), directly under the stage, because the sentence explains the session.
4. Readiness ledger (`readiness-card`): figure, push / steady / rest in words, the non-medical caption, missing inputs, input coverage.
5. Meter ledger (`rings-card`) for load or strain, recovery, sleep. Connect-a-source row stays (`connect-source-cta`) when no wearable is connected.
6. Weekly review, when present, as a ledger of wins / watch / next week.
7. Training week (`training-week-card`): seven day cells, today outlined in `brand` because it is the selected day.
8. Quick row: plan, labs, sources, check-in, then trends, record, and train-with-a-coach as quiet rows. These are destinations, not a second brand.
9. HRV and resting HR as two small ledgers.
10. Muscle preview (`home-heatmap-card`): compact, `spinning={false}`, same honest caption. Press opens `/muscles`.

`LiveNowStrip`, morning check-in (`home-morning`), and did-you-know stay. They are rows, not stages.

Wide web: stage on the left, readiness and meters on the right, week under the meters. See `home-desktop.png`. Do not center a marketing hero with the data hidden below a fold of photographs.

### Workouts `(tabs)/workouts`

History stays a flat session list (date, title, meta). Library gains poster tiles and a “Play demo” control (`exercise-demo-*`). Filters keep a single selected chip in brand. The new-session control (`fab-new-workout`) is the brand action. Search field uses the input spec.

### Logger `workout/[id]`

No stage and no poster. Screen title is the exercise. Sets are a table. Rest is a Space Mono figure with Skip as a quiet button. Kg and reps fields are large. Log set is the brand button. “Watch the squat demo” is a text link that opens the demo frame. Optimistic “Saving” stays in `textMuted`. Finish hides the entry bar, as today.

### Programme `program`

A week of day ledgers. Start day is brand (`start-day-*`). Generate is brand when there is no plan (`generate-btn`). Goal, level, days, and equipment chips follow the one-selected-chip rule. No photography.

### Labs `labs`

Educational banner stays (`labs-education`, `disclaimer-banner`). Marker cards are ledgers. Reference range is a chart band plus words, not a diagnosis. Upload has one brand primary; the second upload is quiet. No stock photography of blood or bodies.

### Trends `analysis`

One line chart per series (`trend-*-chart`). Missing series keep “Not measured” (`trend-*-not-measured`) instead of a zero line. Range tabs: selected tab in brand text, not a brand flood across the page.

### Sources `sources`

Connection rows. Simulated mode says “Sample data. This is not a live reading.” in `warningText`. No device photography required.

### Anatomy `muscles`

Full SVG explorer, front/back control, one selected side in brand text. Body uses the retokened load colors and an ivory selection outline. Detail sheet is the float tier. Do not autoplay a 3D turntable. The existing “share of logged volume, not a scan” line stays.

### AI coach `coach/chat`

Header: back, 40px portrait, “Coach”, and the caption “Training guidance, not a diagnosis.” Assistant bubbles are `surface` with a hairline. Member bubbles are `surface2`. Send is brand (`coach-chat-send`). Empty state is the portrait and “Ask about training, recovery, or your labs.” Errors use `errorText`, including the offline and rate-limit sentences. Do not put the stage photograph behind the thread.

### Human coach application `coach/onboarding`

A form. No AI portrait. Submit for review is brand. Status is a ledger. This screen is about a person applying to coach members, not about the product’s illustrated coach.

### Morning `morning`

Quiet sleep check-in. A 40px coach portrait is allowed beside the prompt because the sentence is addressed to the coach. No stage.

### Auth `auth`

One full-bleed training photograph or the coach at a distance, with the same bottom scrim. The form sits on solid `bg` in the lower half. The continue button is a brand pill. No neon texture. No glass fields.

### Community `(tabs)/community`

Member media is the photography. Do not restage the feed as Night Studio posters. The existing primary (`community-primary-cta`) stays the brand control. Selected scope and category chips follow the chip rule. Rankings and coach rows use member avatars, not the AI persona.

### Profile, settings, messages, DMs, notifications, search, support, Pro, gym, check-in, record, live, stories, posts

Inherit type, color, contrast, and the button rules. Do not add a stage.

- Check-in uses the camera as a tool. The result is a ledger.
- Record outside: start is brand. A route line, if drawn, uses the chart series rule (`text`, selected `brand`).
- Live rooms show the member’s camera. That is content. Chrome around it stays flat.
- Pro: one sentence and one brand purchase button. No glow around the price.
- Partner and gym management stay operational ledgers. They are closer to staff in density and they still use member tokens, not `staffColors`, because they are member-app routes today.

### Staff

Out of scope. `frontend/staff` and `frontend/src/components/admin` keep Precision Performance, `staffColors`, staff type, staff motion, and the staff rule that photography and WebGL are absent. Do not point those files at `palette.ts`. Do not retoken staff `textDim`. Do not put the coach on the sign-in screen.

## 8. Accessibility

- Text pairs in §4.2 stay at or above 4.5:1. New copy uses `text`, `textMuted`, `textDim`, `brandOn`, or a `*Text` token. It does not use `error`, `volt`, `blaze`, or `brand` for sentences.
- Non-text UI that must be identified without its label (focus ring, selected outline, demo outline, input focus) uses `text` or `edge`, both of which clear 3:1 on `surface` and `surface2`.
- Status is a word plus a mark: Not connected, Not measured, Recorded zero, Measured, Sample data, Push day, Steady day, Rest day, Productive load, and the lab education line.
- Targets: 44×44 minimum, 48 tall for the primary button. Tab items already request 44.
- Focus visible on web: 2px `text` ring, offset 2px, including the brand button (ring outside the fill, not a brand-on-brand ring).
- Reduced motion: durations 0, no stage Ken Burns, no heatmap yaw, no video autoplay, no shimmer.
- Charts and meters expose the same sentence a screen reader would need if the stroke disappeared. The figure’s accessible name includes the label, the value, and the caption (“Recovery, not connected”).
- Video: poster has alt text, controls are the native ones, captions when a file exists.
- Coach and poster images: alt text is the role or the exercise name. Decorative duplicates of the same portrait beside a visible “Coach” eyebrow use empty alt.
- Color is not the only selected state. Selected chips change fill and label color to `brandOn`. Selected tabs change label and icon to `brand` and set `accessibilityState.selected`.
- The readiness and lab disclaimers stay visible text, not only a tooltip.

## 9. Dependencies and licensing

Already in `frontend/package.json`, and enough for this spec:

| Package | Use |
|---|---|
| `expo-image` | Portraits, posters, avatars, post photos |
| `expo-linear-gradient` | Stage and auth scrim only |
| `expo-video` | Demo and community video |
| `react-native-svg` | Charts and anatomy |
| `react-native-reanimated` | Existing press and transitions |
| `@gorhom/bottom-sheet` | Sheets |
| `expo-haptics` | Set logged, rest complete |
| `@expo/vector-icons` (Ionicons) | Icons, already the set |

No new packages. Do not add `three`, `expo-gl`, `lottie-react-native`, `rive-react-native`, a Google font loader, or a stock SDK.

`expo-blur` may stay installed. Night Studio does not call it.

Fonts: Barlow and Barlow Condensed, SIL OFL, copyright the Barlow Project Authors, notice in `frontend/assets/fonts/OFL.txt`. Space Mono, SIL OFL, Colophon Foundry. Both allow bundling in the app. They do not allow the font files alone to be sold. Reserved names stay if anyone modifies the files. Do not add Satoshi, Inter, or a commercial display face.

Anatomy paths: MIT, react-native-body-highlighter, credit already in `anatomy-artwork.ts`.

Design-reference SVGs and PNG screenshots in `docs/design-refs/` are original and carry no third-party photo license. They are not runtime assets. The app should not import them.

## 10. What an implementation changes, and what it leaves

Change, later, in member files only:

- Home composition: stage, coach line under it, meters instead of three dials, heatmap not spinning.
- Library poster tiles and the demo poster.
- Coach chat header portrait and `errorText` on failures.
- Chart series colors and the anatomy load map.
- Optional tokens `edge` and `type.stage` in `palette.ts` / `theme.ts`.

Leave:

- `metric-state.ts` behavior and its tests.
- Spacing and radius numbers.
- Staff files and `staffColors`.
- Test IDs listed in this spec.
- The decision that a gap is not a zero and that sample data is labeled.

`design_guidelines.json` still describes the shipped first pass, including screen notes that mention Whoop-style rings and a glass record button. Those two notes are the ones this spec replaces for members. Update that file only in the implementation pass, so the shipped app and the guidelines do not diverge before the code moves.

## 11. How to read the references

`board.png` is the choice. The other PNGs are Night Studio, the recommended column, drawn at the sizes the app already targets (a 390-wide phone and a wide home). The people in the SVG stand-ins are drawings made for this document. Replace them with commissioned photographs before they are treated as brand imagery. Do not trace a real athlete into the product from these files.
