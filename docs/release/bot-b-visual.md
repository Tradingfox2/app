# Bot B — IronFlow Motion / Night Studio visual pass

Status: proposal only. This pass does not change application code. The staff console stays on Precision Performance.

Baseline, checked in this workspace: `HEAD` is `9604bac` (“Upgrade Expo SDK 54 to 57 for Expo Go”). `089ec98` (“Athlete app: IronFlow Motion + Night Studio redesign”) is an ancestor of that commit. The member materials in `frontend/src/palette.ts`, `frontend/src/theme.ts`, and `design_guidelines.json` are the Night Studio set: ground `#101418`, action `#D6E35A`, bundled OFL faces. This pass improves that direction. It does not replace it.

Owner constraints held in every recommendation: the ground stays dark; chartreuse is the primary action and the selected state; staff screens are out of scope.

## How this was judged

- Source read for sign-in, the poster plate, the coach mark, Home, the logger, the library, the demo modal, sources, and the token files.
- Expo web at `http://localhost:8082` with `EXPO_PUBLIC_SENTRY_DISABLED=1`. Chrome, signed-in synthetic athlete Ada Lift, mocked `/api`. Viewports **390×844, 768×1024, 1280×800, 1440×900**.
- Screenshots and `measurements.json` are in `docs/release/bot-b/`. Re-capture with `node docs/release/bot-b/capture.mjs` from `frontend/` while that server is up. No remote image host was requested during the auth capture. `frontend/` source contains no Pexels or Unsplash URL. The stock URLs still written in `design_guidelines.json` `images` are not what the app renders.
- Native iOS and Android were not launched. The live backend was not started.

| File | What it shows |
|---|---|
| `auth-390x844.png`, `auth-768x1024.png`, `auth-1280x800.png`, `auth-1440x900.png` | Sign-in. The template mark and the word Placeholder. |
| `auth-register-390x844.png`, `auth-error-390x844.png` | Role selection, and the failed sign-in sentence. |
| `home-390x844.png`, `home-768x1024.png`, `home-1280x800.png`, `home-1440x900.png` | Home with a plan, sample strain 0, sample recovery 80, sleep not measured. |
| `home-loading-390x844.png`, `home-failed-390x844.png`, `home-disconnected-390x844.png`, `home-disconnected-1440x900.png`, `home-empty-390x844.png`, `home-coach-offline-390x844.png` | Loading, failed, disconnected, no plan, AI offline. |
| `home-tips-390x844.png` | Home scrolled to the tip carousel. |
| `library-390x844.png`, `library-1440x900.png`, `demo-modal-390x844.png` | Exercise rows and the demo sheet. |
| `sessions-empty-390x844.png`, `workouts-failed-390x844.png` | Empty history and a failed library load. |
| `logger-390x844.png`, `logger-768x1024.png`, `logger-1280x800.png`, `logger-1440x900.png` | Set logger. |
| `logger-add-error-390x844.png`, `logger-rest-offline-390x844.png` | Missing reps, then rest plus a failed sync. |
| `sources-sample-390x844.png`, `sources-failed-390x844.png` | Sample versus live, and a failed source list. |
| `glyph-sheet.png` plus `art/*.svg` | Original plate glyphs proposed below. |

## What already holds

Checked on the rendered member app and in source. These stay.

- Ground is `#101418`. Home stage fill computed as `rgb(16, 20, 24)`. The stage scrim runs from `brandWash` into that ground. There is no second black and no photograph pretending to be licensed.
- Chartreuse on Home is the start control. At 1440 the stage is **660×420** at x **176**, and readiness starts at x **848**. The shell is **1120** wide. At 768 the column is the centered **480** shell (content about x 160–607). At 390 the stage uses the phone width. No horizontal overflow on the measured Home, auth, or logger documents.
- Home type is the licensed faces. The stage title “PUSH” computed as `IronflowDisplayStrong` at **40px**, weight **400**, tracking **0.2px**. The name “Ada Lift” computed as `IronflowDisplay` at **32px**. The coach eyebrow is `IronflowTextStrong` at **16px**.
- Unknown is not zero. Disconnected Home shows **—**, “Not connected”, and the connect row (`home-disconnected-390x844.png`). Sleep on the sample fixture shows “Not measured”. A simulated strain of **0** shows **0** and “Sample data”. A simulated recovery of **80** shows **80** and “Sample data”. Sources prints “Sample data. This is not a live reading.” on Garmin and “LIVE” on Whoop (`sources-sample-390x844.png`).
- Loading Home is three `surface3` bars labeled for loading, not three dials (`home-loading-390x844.png`). A failed Home uses ivory text on `errorWash` and a Retry control (`home-failed-390x844.png`). An empty plan offers one brand control, Generate plan, and a quiet Start empty (`home-empty-390x844.png`). AI offline keeps the row readable and says “AI OFFLINE” (`home-coach-offline-390x844.png`).
- An empty session list is one sentence and one brand button (`sessions-empty-390x844.png`). The logger’s add control is the brand square. An empty rep field says “Enter reps and weight before adding a set.” in `errorText` (`logger-add-error-390x844.png`). Play demo is an `edge` outline with the words visible (`library-390x844.png`).
- `frontend/staff` and `frontend/src/components/admin` were not opened for a redesign and were not edited. Member proposals below do not import into those trees and do not retoken staff.

## 1. Critique

The Night Studio ledger is in place. The pictures are not. The member still meets the Expo template mark, and two screens say so in words.

### The template mark is still the brand

`frontend/assets/images/icon.png`, `adaptive-icon.png`, `splash-image.png`, `app-image.png`, and the favicon are the Expo / React Native logo. `app.json` points the installed icon and the splash screen at those files. `frontend/app/auth.tsx` draws that file at 88px and then prints the word **Placeholder** (`auth.tsx` lines 49–56). On the 390 sign-in, that word computed at **12px**, color `rgb(168, 178, 188)`, y **217**, in the system font. The wordmark **IRONFLOW** above it computed as the system UI stack, **42px**, weight **900**, not Barlow Condensed (`measurements.json`).

The same file is the coach portrait. `CoachMark` in `frontend/src/components/night/coach-mark.tsx` loads `icon.png` into the 48px circle on Home, in coach chat, and on the morning check-in. The eyebrow already says Coach, so the image is hidden from the accessibility tree, and a sighted member still sees the template logo (`home-390x844.png`, `home-coach-offline-390x844.png`).

`PosterPlate` paints the same logo and the word **Placeholder** on every library row (`coach-mark.tsx` lines 32–46). The library uses the compact plate (`workouts.tsx`). The capture waited on the visible word before saving `library-390x844.png` and `library-1440x900.png`. Renaming that word to “No photo” would leave the template logo in the tile. That is a label change. The tile needs a drawing that belongs to the product.

The demo sheet has a second development sentence. With no video URL, `exercise-demo-modal.tsx` says “Video simulation will appear here when curated media is available.” The capture waited on that sentence (`demo-modal-390x844.png`). The stage behind it is a 58px circle and a barbell icon. There is no simulation to wait for. The exercise library’s `category` field is `"strength"` for all **217** seeded movements (`backend/muscle_recommendations.py`); the field that actually differs is equipment: bodyweight 70, machine 60, dumbbell 46, barbell 39, kettlebell 2. A plate system keyed by equipment, with a movement drawing on the large stage, matches the data the app already has.

`design_guidelines.json` still describes the auth hero as “the existing app icon marked Placeholder” and still lists three remote stock URLs under `images`. The running app does not request those URLs. They should leave the guidelines in the same change that replaces the mark, so a later pass does not wire them up.

### Chartreuse leaks off the action

The rest timer’s box uses `borderColor: colors.brand` (`workout/[id].tsx`). After a valid add, computed `border-top-color` was `rgb(214, 227, 90)` (`logger-rest-offline-390x844.png`). The add control below it is already the brand action. The timer is a status, and Skip is quiet.

The Home tip carousel colors its category icons from a private map. Nutrition computed `rgb(255, 138, 0)` (`blaze`) and hydration computed `rgb(182, 241, 58)` (`volt`) inside `did-you-know` (`home-tips-390x844.png`, `did-you-know.tsx`). Those are a second neon beside chartreuse. The spec already parked `volt` and `blaze` as legacy marks.

### Wide auth and the wide logger stretch the phone column

At 1440 the Home split is right: stage 660, readiness at x 848. Auth and the logger inherit the same **1120** shell and then behave like a phone row pulled wide.

Sign-in fields at 1440 sit on a `surface2` span from x **185** to **1254** (about 1070px) at y **320**, inside the 42% hero (`auth-1440x900.png`). The brand button is that same width. At 768 the fields stay inside the 480 column, which is the right width for this form.

The logger at 1440 is a **1120×900** screen. The reps field is **160×56** at x **172**. The add button is **60×56** at x **676**. The entry bar continues across the shell with an empty run to the right (`logger-1440x900.png`, `logger-1280x800.png`). At 768 the logger is the 480 column and the fields sit with the button as one cluster (`logger-768x1024.png`).

### Sentences still set in the mark red

The failed sign-in sentence computed and sampled as `rgb(226, 59, 59)`, which is `colors.error` `#E23B3B` (`auth.tsx` style `err`, `auth-error-390x844.png`). On `#101418` that pair is **4.34:1**. Body text needs **4.5:1**. `errorText` `#FFB4AE` is the token that clears it. The failed session list uses the same mark color at **12px** (`workouts.tsx` `createError`, `workouts-failed-390x844.png`). Home’s own failure banner already uses ivory on `errorWash`. Sources’ failure banner uses an `errorText` stroke and ivory copy (`sources-failed-390x844.png`). Those two are the pattern.

### Small type that survived the last pass

Home quick labels and week letters are **12px**. These are still under that floor: training stat labels **10px** (`statLabel`, used for sets, minutes, muscles), “Push day” / missing / coverage at **11px** (`ringCaption`), the streak pill at **11px**, logger field labels and the “SETS” header at **10px**, library equipment meta at **11px** and the category badge at **10px**, demo eyebrows at **10px**. The demo close control is **36×36**.

## 2. Ranked changes

### ESSENTIAL FOR RELEASE

1. **Replace the template mark and the word Placeholder with the plate glyphs.** Auth hero, coach circle, library plate, demo stage, and the installed icon / splash. Evidence: `auth-*.png`, `library-*.png`, `coach-mark.tsx`, `app.json`, the asset PNGs. Drafts: `docs/release/bot-b/art/`.
2. **Set the sign-in wordmark in the licensed display face, and keep the form in a narrow column.** `IRONFLOW` is system-ui at weight 900. Fields at 1440 are ~1070px wide and overlap the hero. Evidence: `measurements.json` `authWord`, `auth-1440x900.png`.
3. **Make the demo stage the movement drawing plus the written execution.** Remove “Video simulation will appear here when curated media is available.” Raise the close control to 44×44. Evidence: `demo-modal-390x844.png`, `exercise-demo-modal.tsx`.
4. **Take chartreuse off the rest timer, and take `volt` / `blaze` off the tip icons.** Evidence: timer border `rgb(214, 227, 90)`; tip colors `rgb(255, 138, 0)` and `rgb(182, 241, 58)`.
5. **Keep the logger in a reading column on the 1120 shell.** Home stays 1120 with the stage on the left. The logger matches the 768 column. Evidence: add button x 676 inside a 1120 logger.
6. **Set the sign-in error and the session-list error in `errorText`.** Evidence: sampled `rgb(226, 59, 59)` on `auth-error-390x844.png`; `createError` on `workouts-failed-390x844.png`.

### OPTIONAL POLISH

7. Raise the remaining 10–11px labels on Home, the logger, the library, and the demo sheet to 12px.
8. Stop the tip carousel’s 8s auto-advance. Reduced motion already skips it. The colors in item 4 are the release cut; the loop is polish.
9. Move other member `colors.error` sentences (labs, profile, messages, record, and the rest of that list) to `errorText` in one sweep. Home and sources already use the readable pattern.
10. Delete the `images` stock URLs and the “marked Placeholder” sentence from `design_guidelines.json` in the same change as the mark. The app does not load them today.
11. Drop the italic on “No sets logged yet.” and the flame glyph on the streak pill. Both are small departures from the ledger.

## 3. Screen and component recommendations

### Sign-in `frontend/app/auth.tsx`

The hero is a plate, not a photo and not the template logo. Center `art/mark.svg` at 88px on `bg`. Keep the existing bottom scrim. Delete the Placeholder text node. The wordmark uses `fonts.displayStrong` (Barlow Condensed Bold) at weight **400**, so the browser does not faux-bold the Bold file, with tracking near **0.2** rather than **4**. The tagline uses `type.body`. The continue control stays a brand fill with `type.button` and a `brandOn` label. Role chips stay brand when selected. The error sentence uses `errorText`.

Above 480px the form column is **420** wide and centered. The plate can be wider than the form. The fields do not stretch to 1120, and they sit below the plate rather than on top of it. At 768 the current 480 shell is already the right width.

### Coach mark

`CoachMark` draws the same monogram in a circle on `surface3`. When the eyebrow says Coach, the image stays decorative (empty alt), as it does now. When a commissioned portrait exists later, this component is the only swap. Do not ship the drawn person in `docs/design-refs/portrait-coach.svg`. That file is a spec stand-in, and the spec says not to treat it as the coach. Do not invent a face to fill the circle.

### Poster plate and demo stage

`PosterPlate` takes `slug`, `name`, `equipment`, and `primaryMuscle`. The compact library tile (84×72, `surface3`) shows one equipment glyph at about 40px and no caption. The exercise name already sits beside the tile. The large plate, used by the demo stage, shows the movement glyph and the exercise name in `type.section`. The word Placeholder is deleted in both sizes.

Movement choice, in order: squat/lunge → squat; deadlift/hinge/swing → hinge; row/pull/pulldown/chin → pull; abs/obliques/plank/crunch → core; muscle `cardio` → stride; press/push/dip/fly → press; otherwise the equipment glyph. All **217** library rows are category `strength`, so a category glyph would be one drawing repeated. Equipment plus the name pattern is the system the data can drive.

The demo sheet’s stage is that large plate on `bg`. The execution paragraph stays. If `video_url` is missing, the sheet is the technique card: no promise of a future simulation, no brand button. If a video URL exists, Watch demo stays the brand control, and the plate is the poster until play. The close control is **44×44** with a solid `surface` chip, per the existing spec.

### Home

Composition stays: stage, coach line, readiness, meters, week. The coach circle uses the monogram until a photograph is commissioned. The stage stays the `brandWash` → `#101418` scrim. Do not put a glyph in the stage; the stage is the session, and the start control is the one brand object there.

Tip icons use `text`, `info`, `success`, or `warning` as marks, with the category word still visible. `volt` and `blaze` are not icon colors. Stat labels and the “Push day” line move to 12px when the optional type pass lands.

### Logger `workout/[id]`

No poster and no stage, as now. On viewports at or above 1100, wrap the logger column at **640** and center it in the 1120 shell. Home does not get that cap. The entry fields keep `maxWidth: 160`. The rest timer border becomes `borderStrong`. The number stays Space Mono. Skip stays quiet. Log set stays the brand square. The pending-sync row and the `errorText` add error stay.

### Library, empty, failed

The empty session state stays one sentence and one brand button. The failed list sentence moves to `errorText`. Filter chips stay one selected brand chip. New session stays the brand bar. Play demo stays the `edge` outline.

### Sources

Sample versus live already works. Leave the copy and the warning-text sample line. No device photography.

### Icon and splash

Rasterize `mark.svg` in ivory on `#101418` for `icon.png`, `adaptive-icon.png`, `splash-image.png`, and `favicon.png` when the implementation lands. Those rasters are not in this branch. The SVG draft is the reference. Staff sign-in keeps its own inline mark.

## 4. Implementation proposal

Stack already in `frontend/package.json`: `react-native-svg` for the glyphs, `expo-linear-gradient` for the auth scrim, `expo-font` for the faces already loaded by `useAthleteFonts`. No new package. No remote image. No 3D. No Lottie or Rive. No stock SDK.

The SVG files in `docs/release/bot-b/art/` are original drawings for this proposal. They are references. The app should not import them from `docs/`. An implementation copies the paths into a member-only module, for example `frontend/src/components/night/plate-glyphs.tsx`, and renders them with `react-native-svg`. Stroke is `#F2F3F4` (`colors.text`) at 2.25 on a 64 viewBox, round caps, no fill. Chartreuse is absent from the artwork. The contact sheet is `glyph-sheet.png`.

Files:

| File | Role |
|---|---|
| `art/mark.svg` | Monogram for auth, the coach circle, the app icon, and the splash. |
| `art/glyph-barbell.svg`, `glyph-dumbbell.svg`, `glyph-kettlebell.svg`, `glyph-machine.svg`, `glyph-bodyweight.svg` | Equipment plates for the library row. |
| `art/glyph-press.svg`, `glyph-squat.svg`, `glyph-hinge.svg`, `glyph-pull.svg`, `glyph-core.svg`, `glyph-stride.svg` | Movement plates for the demo stage. |

The body drawings are diagrams: one stroke weight, a featureless head circle, no face, no portrait, no coach. They are not a person we are claiming to have photographed.

Sketch, member files only, when someone implements this:

```tsx
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { colors } from "@/src/theme";

const stroke = { stroke: colors.text, strokeWidth: 2.25, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

export function IronflowMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect x={8} y={18} width={8} height={28} rx={2} {...stroke} />
      <Path d="M16 32h32" {...stroke} />
      <Rect x={48} y={18} width={8} height={28} rx={2} {...stroke} />
    </Svg>
  );
}

export function equipmentKey(equipment?: string): "barbell" | "dumbbell" | "kettlebell" | "machine" | "bodyweight" {
  switch (equipment) {
    case "dumbbell":
    case "kettlebell":
    case "machine":
    case "bodyweight":
    case "barbell":
      return equipment;
    default:
      return "barbell";
  }
}
```

`PosterPlate` stops requiring `icon.png`. `posterPlaceholder` is removed. Auth drops the `Image` require and the Placeholder `Text`. `CoachMark` renders `IronflowMark` inside the existing circle. The demo stage renders the movement glyph from the same module. A `never` check on the equipment union keeps a new equipment value from falling through silently; unknown equipment uses the barbell plate until a glyph is added.

Auth wordmark style becomes `fontFamily: fonts.displayStrong`, `fontWeight: "400"`, `fontSize: 40`, `letterSpacing: 0.2`. The error style becomes `color: colors.errorText`. The form gains `width: "100%"`, `maxWidth: 420`, `alignSelf: "center"` inside the existing shell. Staff `frontend/staff/auth.tsx` is not part of this edit.

Logger shell: in `frontend/app/_layout.tsx` the board max width stays **1120** for Home. The workout route applies its own **640** cap. Do not lower the Home cap to fix the logger.

Tip colors: replace the `CATEGORY_COLOR` entries that point at `colors.volt` and `colors.blaze` with `colors.info` and `colors.warning`. Words stay `text` / `textMuted`.

Rest timer: `borderColor: colors.borderStrong`.

Out of scope for the implementer of this proposal: staff files, spacing and radius numbers, `metric-state.ts`, and any remote URL in `design_guidelines.json`.

## 5. Accessibility and responsive notes

Text that this pass asks to change:

| Surface | Current | Target |
|---|---|---|
| Sign-in error | `#E23B3B` on `#101418`, about 4.34:1, sampled `rgb(226, 59, 59)` | `errorText` `#FFB4AE` |
| Session list error | `colors.error` at 12px | `errorText` |
| Home failure, sources failure, logger add error | ivory or `errorText` already | leave |
| Rest timer border | brand `#D6E35A`, the only signal besides the word Rest | `borderStrong`, word and number remain |
| Tip icons | `blaze`, `volt` | a mark token plus the category word |
| Demo close | 36×36 | 44×44 |
| Placeholder word | 12px `textDim`, contrast passes, content is a development label | remove the node |

The monogram and the equipment glyphs are decorative next to a visible name (the wordmark, the coach eyebrow, or the exercise name). They take an empty accessibility label. The demo stage’s glyph is decorative beside the visible exercise title. The execution paragraph remains the text alternative for the movement.

Selected chips already change fill and label color together (library filters, auth role). Selected tabs already set the brand tint. This proposal does not add a chartreuse-only state.

Focus: this pass did not re-tab the start control. The 2px light ring from the Night Studio review is still the rule. Chartreuse stays off the focus ring.

Reduced motion: this pass did not re-test `prefers-reduced-motion`. The proposal adds no loop. The optional carousel cut removes the one 8s advance that still runs when reduced motion is off.

Responsive, from the four viewports:

| Viewport | Home | Logger | Sign-in |
|---|---|---|---|
| 390×844 | Phone column. Stage under the name. Meters readable. Placeholder visible on sign-in and in the library. | Entry cluster fits. Rest timer and sync row stack in the column. | Hero and form overlap; Placeholder sits at y 217 under the tagline. |
| 768×1024 | Centered 480 column. Spec already asks for this. Side ground stays empty. | Same 480 column. Fields and the add button are one cluster. | Fields stay near 430px. Correct width. |
| 1280×800 and 1440×900 | Shell 1120. Stage 660 left, readiness at x 848. Meters in the right column. | Shell 1120. Add button at x 676, then empty bar. Cap the column at 640. | Fields about 1070px wide, overlapping the hero. Cap the form at 420. |

No new overflow was introduced by these recommendations because they only narrow columns that are already inside the shell.

## Staff

Untouched. `frontend/staff/auth.tsx` keeps `staffColors` and its own mark. This proposal does not import `palette.ts` into staff, does not put the member monogram on the staff sign-in, and does not change staff type, motion, or layout.
