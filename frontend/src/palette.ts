/**
 * Member palette for IronFlow Motion.
 * Staff console colors live in `components/admin/staff-theme.ts` and must not
 * import this file. Spacing and radius stay in `theme.ts` because the staff
 * console still reads those layout numbers.
 *
 * `error`, `success`, `info`, `warning`, `blaze`, and `volt` are for strokes,
 * dots, and large marks. Small copy uses the `*Text` tokens, which clear
 * WCAG AA 4.5:1 on bg, surface, surface2, and surface3.
 */
export const colors = {
  bg: "#101418",
  surface: "#1A1F24",
  surface2: "#242A31",
  surface3: "#2E3842",
  border: "#3A4652",
  borderStrong: "#52606C",
  /** Non-text boundary. Not a sentence color, and not copied into staff. */
  edge: "#6E7C8A",
  /** Untrained anatomy mark. Not text. */
  anatomyIdle: "#8C5A56",
  text: "#F2F3F4",
  textMuted: "#C5CCD3",
  textDim: "#A8B2BC",
  hero: "#FFFFFF",
  brand: "#D6E35A",
  brandOn: "#16180C",
  brandWash: "#243018",
  live: "#E23B3B",
  pr: "#E4B15A",
  errorWash: "#3A1818",
  warningWash: "#3A3118",
  ringPlate: "#000000",
  success: "#3D9A6A",
  warning: "#C4A15A",
  error: "#E23B3B",
  info: "#7AA2C9",
  successText: "#8FE0B5",
  warningText: "#F0D59A",
  errorText: "#FFB4AE",
  infoText: "#C9E2F8",
  volt: "#B6F13A",
  blaze: "#FF8A00",
};

/** Foreground/background pairs that must clear 4.5:1. Graphical marks are separate. */
export const textContrastPairs: readonly (readonly [string, string])[] = [
  [colors.text, colors.bg],
  [colors.text, colors.surface],
  [colors.text, colors.surface2],
  [colors.text, colors.surface3],
  [colors.textMuted, colors.bg],
  [colors.textMuted, colors.surface],
  [colors.textMuted, colors.surface2],
  [colors.textMuted, colors.surface3],
  [colors.textDim, colors.bg],
  [colors.textDim, colors.surface],
  [colors.textDim, colors.surface2],
  [colors.textDim, colors.surface3],
  [colors.hero, colors.bg],
  [colors.brandOn, colors.brand],
  [colors.errorText, colors.bg],
  [colors.errorText, colors.surface],
  [colors.errorText, colors.errorWash],
  [colors.successText, colors.bg],
  [colors.successText, colors.surface],
  [colors.warningText, colors.bg],
  [colors.warningText, colors.warningWash],
  [colors.infoText, colors.bg],
  [colors.infoText, colors.surface],
];
