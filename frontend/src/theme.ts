import { Platform, type TextStyle, type ViewStyle } from "react-native";

export const colors = {
  bg: "#090A09",
  surface: "#121412",
  surface2: "#1A1D19",
  surface3: "#242823",
  border: "#2C302A",
  borderStrong: "#464D41",
  text: "#F5F7F2",
  textMuted: "#A2A99D",
  textDim: "#687064",
  brand: "#D4FF00",
  brandOn: "#090A09",
  brandDim: "#293300",
  accent: "#9DFF00",
  success: "#39FF14",
  warning: "#FFB000",
  error: "#FF453A",
  info: "#E8FF65",
  volt: "#B6F13A",
  blaze: "#FF8A00",
  pr: "#FFD23F",
};

export const alpha = {
  brandSoft: "rgba(212,255,0,0.14)",
  infoSoft: "rgba(232,255,101,0.14)",
  prSoft: "rgba(245,184,61,0.18)",
  tabFill: "rgba(212,255,0,0.12)",
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
    web: "Barlow Condensed, Inter, system-ui, sans-serif",
    default: "System",
  }) as string,
  text: Platform.select({
    web: "Inter, system-ui, sans-serif",
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
    fontWeight: "700",
    letterSpacing: 1.6,
  } satisfies TextStyle,
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  } satisfies TextStyle,
  body: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  } satisfies TextStyle,
  metric: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.3,
    ...tnum,
  } satisfies TextStyle,
  caption: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  } satisfies TextStyle,
  button: {
    color: colors.brandOn,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.2,
  } satisfies TextStyle,
};

export const card: ViewStyle = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: radius.lg,
};

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 };
