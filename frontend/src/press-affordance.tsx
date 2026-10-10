import { useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors } from "@/src/theme";

/**
 * Hover and press cue for Community and You controls.
 *
 * Chartreuse stays on primary fills. Hover brightens that fill slightly.
 * Everything else lifts toward the sheet color or, when that would not
 * read, draws a hairline. Press eases scale and opacity. Reduced motion
 * keeps the same cues and drops the animation.
 */
export type AffordanceSignal = "raise" | "hairline" | "brand" | "none";

/** A slight brighten of `colors.brand` (#D6E35A). Not a new brand color. */
const BRAND_HOVER = "#DDE874";
const MOTION_MS = "140ms";

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

type AffordanceStyle = ViewStyle & {
  cursor?: "pointer";
  outlineWidth?: number;
  outlineStyle?: "solid";
  outlineColor?: string;
  outlineOffset?: number;
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
};

type WebExtras = {
  title?: string;
  onClick?: (event: { preventDefault?: () => void }) => void;
  tabIndex?: number;
};

export type AffordanceProps = Omit<PressableProps, "style"> &
  WebExtras & {
    style?: StyleProp<ViewStyle>;
    /** `raise` lifts the surface. `brand` only brightens a primary fill. `none` leaves today's look. */
    signal?: AffordanceSignal;
  };

let reduceMotion = readReduceMotion();
let watching = false;
const listeners = new Set<() => void>();

function readReduceMotion(): boolean {
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return false;
}

function publish(next: boolean) {
  reduceMotion = next;
  listeners.forEach((listener) => listener());
}

function watchReduceMotion() {
  if (watching) return;
  watching = true;
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    publish(media.matches);
    media.addEventListener?.("change", (event) => publish(event.matches));
    return;
  }
  void AccessibilityInfo.isReduceMotionEnabled().then(publish).catch(() => undefined);
  AccessibilityInfo.addEventListener("reduceMotionChanged", publish);
}

function subscribe(listener: () => void) {
  watchReduceMotion();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduceMotion, () => false);
}

function motion(reduce: boolean): Pick<AffordanceStyle, "transitionProperty" | "transitionDuration" | "transitionTimingFunction"> {
  return {
    transitionProperty: "background-color, opacity, transform, outline-color",
    transitionDuration: reduce ? "0ms" : MOTION_MS,
    transitionTimingFunction: "ease",
  };
}

function hairline(hovered: boolean): AffordanceStyle {
  if (Platform.OS !== "web") return {};
  return {
    outlineWidth: 1,
    outlineStyle: "solid",
    outlineColor: hovered ? colors.textMuted : "transparent",
  };
}

export function affordanceStyle(
  state: PressState,
  options: { signal?: AffordanceSignal; disabled?: boolean; reduceMotion?: boolean },
): AffordanceStyle | null {
  const signal = options.signal ?? "raise";
  if (signal === "none" || options.disabled) return null;
  const reduce = options.reduceMotion ?? false;
  const hovered = Platform.OS === "web" && Boolean(state.hovered);
  const pressed = Boolean(state.pressed);
  const base: AffordanceStyle = {
    ...motion(reduce),
    ...(Platform.OS === "web" ? { cursor: "pointer" } : {}),
    transform: [{ scale: pressed && !reduce ? 0.98 : 1 }],
    ...(pressed ? { opacity: 0.88 } : {}),
  };
  switch (signal) {
    case "brand":
      return hovered ? { ...base, backgroundColor: BRAND_HOVER } : base;
    case "hairline":
      return { ...base, ...hairline(hovered) };
    case "raise":
      return hovered ? { ...base, ...hairline(true), backgroundColor: colors.surface2 } : { ...base, ...hairline(false) };
    default: {
      const exhaustive: never = signal;
      return exhaustive;
    }
  }
}

function focusRing(state: PressState, blocked: boolean): AffordanceStyle | null {
  // Pressable already tracks focus and passes it into the style callback.
  // A second setState here re-renders during the gesture and can drop the tap.
  if (Platform.OS !== "web" || blocked || !state.focused) return null;
  return {
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: colors.text,
    outlineOffset: 2,
  };
}

/** Drop-in Pressable that shows it can be used. `signal="none"` keeps the current look. */
export function Affordance({ style, signal = "raise", disabled, ...rest }: AffordanceProps) {
  const reduce = useReduceMotion();
  const blocked = Boolean(disabled);
  return (
    <Pressable
      {...(rest as PressableProps)}
      disabled={disabled}
      style={(state) => [
        style,
        signal === "none"
          ? null
          : affordanceStyle(state as PressState, { signal, disabled: blocked, reduceMotion: reduce }),
        focusRing(state as PressState, blocked),
      ]}
    />
  );
}
