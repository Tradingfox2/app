import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * Approved dark visual system.
 * Chartreuse (`brand`) is only for Start, a primary button fill, and the selected tab.
 */
export const colors = {
  bg: "#101418",
  surface: "#1A1F24",
  surface2: "#242A31",
  surface3: "#343B44",
  border: "#343B44",
  borderStrong: "#343B44",
  text: "#F2F3F4",
  textMuted: "#A7ADB4",
  textDim: "#6E767E",
  hero: "#FFFFFF",
  brand: "#D6E35A",
  brandOn: "#16180C",
  live: "#E23B3B",
  pr: "#E4B15A",
  errorWash: "#3A1818",
  warningWash: "#3A3118",
  ringPlate: "#000000",
  success: "#3D9A6A",
  warning: "#C4A15A",
  error: "#E23B3B",
  info: "#7AA2C9",
  volt: "#B6F13A",
  blaze: "#FF8A00",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const fonts = {
  display: Platform.select({
    web: "Inter, system-ui, sans-serif",
    ios: "System",
    android: "sans-serif",
    default: "System",
  }) as string,
  text: Platform.select({
    web: "Inter, system-ui, sans-serif",
    ios: "System",
    android: "sans-serif",
    default: "System",
  }) as string,
};

const tnum = { fontVariant: ["tabular-nums"] as TextStyle["fontVariant"] };

export const type = {
  screenTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.4,
  } satisfies TextStyle,
  eyebrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
  } satisfies TextStyle,
  section: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0,
  } satisfies TextStyle,
  body: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  } satisfies TextStyle,
  hero: {
    color: colors.hero,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.4,
    ...tnum,
  } satisfies TextStyle,
  metric: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.3,
    ...tnum,
  } satisfies TextStyle,
  caption: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
  } satisfies TextStyle,
  button: {
    color: colors.brandOn,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  } satisfies TextStyle,
};

/** Inset card: rings, Today, stats, session history. */
export const card: ViewStyle = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: radius.lg,
};

/** Full-bleed row: feed posts and club rows. No radius, no shadow. */
export const bleedRow: ViewStyle = {
  backgroundColor: colors.surface,
  padding: spacing.lg,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
};

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 };
