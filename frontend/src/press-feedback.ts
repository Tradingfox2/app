import { useCallback, useState, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Platform,
  type PressableStateCallbackType,
  type StyleProp,
  type TextInputProps,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { brandPressed, PRESS_MS, pressMotion, pressOpacity } from "@/src/press-motion";
import { colors } from "@/src/theme";

/**
 * Press and release for the Workout tab, the strength logger, Plan, the rest
 * timer, and session history. Primary chartreuse darkens in place. Filled
 * rows step to the next dark surface. Chips, ghosts, and outlines dim.
 * Disabled controls stay inert. Reduced motion keeps the cue and drops the ease.
 */

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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
  const pressed = state.pressed === true && !disabled;
  const style: MotionStyle = {};

  if (web) {
    style.cursor = disabled ? "auto" : "pointer";
    // A disabled Pressable otherwise lets the pointer fall through to whatever
    // sits behind it, so the cursor stays a pointer. Keep the hit target and
    // show an inert cursor. onPress still does not fire.
    if (disabled) style.pointerEvents = "auto";
  }
  if (!disabled) Object.assign(style, pressMotion(options.reducedMotion === true));

  if (!pressed) return style;

  switch (variant) {
    case "primary":
      style.backgroundColor = brandPressed;
      break;
    case "surface":
      style.backgroundColor = colors.surface2;
      break;
    case "chip":
    case "ghost":
    case "outline":
      style.opacity = pressOpacity;
      break;
    default: {
      const exhaustive: never = variant;
      return exhaustive;
    }
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
    style.transitionDuration = PRESS_MS;
    style.transitionTimingFunction = "ease-out";
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
