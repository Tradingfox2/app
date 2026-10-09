import { useCallback, useState, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Platform,
  type PressableStateCallbackType,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { colors } from "@/src/theme";

/**
 * Hover and press for the Workout tab, the strength logger, Plan, the rest
 * timer, and session history. Chartreuse brightens only on primary fills.
 * Other controls lift toward the sheet color or show a hairline. Disabled
 * controls stay inert. Reduced motion skips the ease and the scale.
 */

const HOVER_MS = "140ms";
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Brand #D6E35A mixed 8% toward white. Hover only, same hue. */
export const brandHover = "#D9E567";

export type PressVariant = "primary" | "surface" | "chip" | "ghost" | "outline";

export type PressOptions = {
  disabled?: boolean;
  reducedMotion?: boolean;
  /** Leave the caller's border alone. Selection already draws a stronger hairline. */
  preserveBorder?: boolean;
};

type PressState = PressableStateCallbackType & { hovered?: boolean };

type MotionStyle = ViewStyle & {
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
};

/** Text inputs accept TextStyle. ViewStyle is not assignable because `userSelect` differs. */
export type FieldTextStyle = TextStyle & {
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
};

export function fieldTextStyle(style: ViewStyle): FieldTextStyle {
  const source = style as FieldTextStyle;
  const next: FieldTextStyle = {};
  if (typeof source.borderColor === "string") next.borderColor = source.borderColor;
  if (source.transitionProperty) next.transitionProperty = source.transitionProperty;
  if (source.transitionDuration) next.transitionDuration = source.transitionDuration;
  if (source.transitionTimingFunction) next.transitionTimingFunction = source.transitionTimingFunction;
  return next;
}

let reducedMotion = false;
let motionStarted = false;
const motionListeners = new Set<() => void>();

function readWebReduced(): boolean | null {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(MOTION_QUERY).matches;
}

function publishReduced(next: boolean) {
  if (reducedMotion === next) return;
  reducedMotion = next;
  motionListeners.forEach((listener) => listener());
}

function startMotionWatch() {
  if (motionStarted) return;
  motionStarted = true;
  const web = readWebReduced();
  if (web !== null && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const media = window.matchMedia(MOTION_QUERY);
    const onChange = () => publishReduced(media.matches);
    queueMicrotask(() => publishReduced(media.matches));
    if (typeof media.addEventListener === "function") media.addEventListener("change", onChange);
    return;
  }
  void AccessibilityInfo.isReduceMotionEnabled?.()
    .then((value) => publishReduced(Boolean(value)))
    .catch(() => undefined);
  AccessibilityInfo.addEventListener?.("reduceMotionChanged", (value: boolean) => {
    publishReduced(Boolean(value));
  });
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      motionListeners.add(listener);
      startMotionWatch();
      return () => {
        motionListeners.delete(listener);
      };
    },
    () => reducedMotion,
    () => false,
  );
}

export function pressStyle(variant: PressVariant, state: PressState, options: PressOptions = {}): ViewStyle {
  const disabled = options.disabled === true;
  const web = Platform.OS === "web";
  const hovered = web && state.hovered === true && !disabled;
  const pressed = state.pressed === true && !disabled;
  const style: MotionStyle = {};

  if (web) {
    style.cursor = disabled ? "auto" : "pointer";
    // A disabled Pressable otherwise lets the pointer fall through to whatever
    // sits behind it, so the cursor stays a pointer. Keep the hit target and
    // show an inert cursor. onPress still does not fire.
    if (disabled) style.pointerEvents = "auto";
    if (!options.reducedMotion) {
      style.transitionProperty = "background-color, border-color, opacity, transform, outline-color";
      style.transitionDuration = HOVER_MS;
      style.transitionTimingFunction = "ease";
    }
  }

  if (!disabled && hovered) {
    switch (variant) {
      case "primary":
        style.backgroundColor = brandHover;
        break;
      case "surface":
        style.backgroundColor = colors.surface2;
        break;
      case "chip":
        if (!options.preserveBorder) style.borderColor = colors.textDim;
        break;
      case "ghost":
        style.backgroundColor = colors.surface2;
        style.outlineWidth = 1;
        style.outlineStyle = "solid";
        style.outlineColor = colors.textDim;
        break;
      case "outline":
        style.backgroundColor = colors.surface2;
        if (!options.preserveBorder) style.borderColor = colors.textDim;
        break;
      default: {
        const exhaustive: never = variant;
        return exhaustive;
      }
    }
  }

  if (pressed) {
    style.opacity = 0.92;
    if (!options.reducedMotion) style.transform = [{ scale: 0.98 }];
  }

  return style;
}

export function usePressFeedback() {
  const reducedMotion = useReducedMotion();
  return useCallback(
    (variant: PressVariant, base?: StyleProp<ViewStyle>, options?: Omit<PressOptions, "reducedMotion">) =>
      (state: PressableStateCallbackType) => {
        const feedback = pressStyle(variant, state, { ...options, reducedMotion });
        return base == null ? feedback : [base, feedback];
      },
    [reducedMotion],
  );
}

export function useFieldAffordance() {
  const reducedMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const web = Platform.OS === "web";
  const style: MotionStyle = {};
  if (web && !reducedMotion) {
    style.transitionProperty = "border-color";
    style.transitionDuration = HOVER_MS;
    style.transitionTimingFunction = "ease";
  }
  if (hovered || focused) style.borderColor = colors.textDim;
  const hover = (
    web
      ? {
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
        }
      : {}
  ) as unknown as ViewProps & TextInputProps;
  return {
    style: style as ViewStyle,
    hover,
    focus: {
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
}
