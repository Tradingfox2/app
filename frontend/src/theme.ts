import { Platform, type TextStyle, type ViewStyle } from "react-native";
import { colors } from "@/src/palette";

/**
 * IronFlow Motion — athletic intelligence for the member app.
 * Chartreuse (`brand`) is the primary action, the selected tab, and little else.
 * Staff console styling stays in `components/admin/staff-theme.ts`.
 * Spacing and radius values are shared with staff layout and must stay stable.
 */
export { colors };

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

/** Short transitions only. Reduced motion sets duration to 0 at the call site. */
export const motion = {
  fast: 140,
  base: 180,
  slow: 240,
};

export const fonts = {
  display: Platform.select({
    web: "IronflowDisplay, system-ui, sans-serif",
    ios: "IronflowDisplay",
    android: "IronflowDisplay",
    default: "IronflowDisplay",
  }) as string,
  displayStrong: Platform.select({
    web: "IronflowDisplayStrong, system-ui, sans-serif",
    default: "IronflowDisplayStrong",
  }) as string,
  text: Platform.select({
    web: "IronflowText, system-ui, sans-serif",
    ios: "IronflowText",
    android: "IronflowText",
    default: "IronflowText",
  }) as string,
  textStrong: Platform.select({
    web: "IronflowTextStrong, system-ui, sans-serif",
    default: "IronflowTextStrong",
  }) as string,
  numeric: Platform.select({
    web: "IronflowNumeric, ui-monospace, monospace",
    default: "IronflowNumeric",
  }) as string,
};

const tnum = { fontFamily: fonts.numeric, fontVariant: ["tabular-nums"] as TextStyle["fontVariant"] };

export const type = {
  screenTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "600",
    letterSpacing: 0.2,
  } satisfies TextStyle,
  stage: {
    color: colors.text,
    fontFamily: fonts.displayStrong,
    fontSize: 40,
    lineHeight: 40,
    // The Bold file is the 700 cut. A second weight would synthesize a stroke.
    fontWeight: "400",
    letterSpacing: 0.2,
  } satisfies TextStyle,
  eyebrow: {
    color: colors.textMuted,
    fontFamily: fonts.textStrong,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
  } satisfies TextStyle,
  section: {
    color: colors.text,
    fontFamily: fonts.textStrong,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    letterSpacing: 0,
  } satisfies TextStyle,
  body: {
    color: colors.text,
    fontFamily: fonts.text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  } satisfies TextStyle,
  hero: {
    color: colors.hero,
    fontSize: 28,
    fontWeight: "400",
    letterSpacing: -0.4,
    ...tnum,
  } satisfies TextStyle,
  metric: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "400",
    letterSpacing: -0.3,
    ...tnum,
  } satisfies TextStyle,
  caption: {
    color: colors.textMuted,
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
  } satisfies TextStyle,
  button: {
    color: colors.brandOn,
    fontFamily: fonts.textStrong,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0.2,
  } satisfies TextStyle,
};

/** Flat data card. Borders separate layers. Shadows are not the default. */
export const card: ViewStyle = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: radius.lg,
};

/** Raised session hero and sheets. Data rows stay on `card`. */
export function raised(tier: "card" | "float"): ViewStyle {
  if (Platform.OS === "web") {
    const boxShadow = tier === "float"
      ? "0 16px 40px rgba(0, 0, 0, 0.45)"
      : "0 10px 28px rgba(0, 0, 0, 0.28)";
    return { boxShadow } as ViewStyle;
  }
  return {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: tier === "float" ? 10 : 6 },
    shadowOpacity: tier === "float" ? 0.35 : 0.22,
    shadowRadius: tier === "float" ? 16 : 10,
    elevation: tier === "float" ? 8 : 3,
  };
}

/** Full-bleed row: feed posts and club rows. No radius, no shadow. */
export const bleedRow: ViewStyle = {
  backgroundColor: colors.surface,
  padding: spacing.lg,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
};

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 };
