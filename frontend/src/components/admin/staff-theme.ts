import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * IronFlow Precision Performance — staff web console only.
 * Member screens keep `frontend/src/theme.ts`. Do not import these tokens there.
 *
 * Ground is the shipped #101418 family from theme.ts. Chartreuse (#D6E35A) is only
 * for a primary action, the selected nav item, and key queue links.
 * Satoshi is not bundled: it is a commercial face. Display and text are Barlow,
 * SIL Open Font License, loaded from frontend/assets/fonts.
 */

export const staffColors = {
  bg: "#101418",
  bgTint: "#1A1F24",
  surface: "#1A1F24",
  surfaceRaised: "#242A31",
  /** Alias so existing card styles can move onto the staff palette without a second gray. */
  surface2: "#242A31",
  surface3: "#343B44",
  border: "#343B44",
  borderStrong: "#4A545E",
  text: "#F2F3F4",
  textMuted: "#A7ADB4",
  textDim: "#6E767E",
  brand: "#D6E35A",
  brandOn: "#16180C",
  brandWash: "#242A31",
  success: "#3D9A6A",
  warning: "#C4A15A",
  error: "#E23B3B",
  /** Alert copy on the dark ground. The icon red above fails contrast as text. */
  errorText: "#FF8A8A",
  errorWash: "#3A1818",
  info: "#7AA2C9",
};

const display = Platform.select({
  web: "BarlowCondensed, system-ui, sans-serif",
  default: "System",
}) as string;

const text = Platform.select({
  web: "Barlow, system-ui, sans-serif",
  default: "System",
}) as string;

export const staffFonts = { display, text };

export const staffType = {
  display: {
    fontFamily: display,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: 0.4,
    color: staffColors.text,
  } satisfies TextStyle,
  section: {
    fontFamily: display,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.6,
    color: staffColors.text,
  } satisfies TextStyle,
  nav: {
    fontFamily: text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  } satisfies TextStyle,
  body: {
    fontFamily: text,
    fontSize: 14,
    lineHeight: 20,
    color: staffColors.text,
  } satisfies TextStyle,
  meta: {
    fontFamily: text,
    fontSize: 12,
    lineHeight: 17,
    color: staffColors.textMuted,
  } satisfies TextStyle,
};

/** Floating chrome only. Tables and queue rows stay flat. Web uses boxShadow; the shadow* props are deprecated there. */
export const staffShadow: ViewStyle = Platform.OS === "web"
  ? ({ boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)" } as ViewStyle)
  : {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.28,
      shadowRadius: 22,
    };

export function staffEnter(reduced: boolean): ViewStyle {
  if (reduced || Platform.OS !== "web") return {};
  return {
    animationDuration: "180ms",
    animationTimingFunction: "ease-out",
    animationName: "ironflow-rise",
  } as ViewStyle;
}
