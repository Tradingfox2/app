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
import { brandPressed, pressMotion, pressOpacity } from "@/src/press-motion";
import { colors } from "@/src/theme";

/**
 * Press and release for Community and You controls.
 *
 * Filled rows step to the next dark surface. Unfilled controls dim.
 * Primary chartreuse darkens in place. Reduced motion keeps the cue
 * and drops the ease. `none` leaves today's look.
 */
export type AffordanceSignal = "raise" | "hairline" | "brand" | "none";

type PressState = PressableStateCallbackType & { hovered?: boolean };

type AffordanceStyle = ViewStyle & {
  cursor?: "pointer";
  outlineWidth?: number;
  outlineStyle?: "solid";
  outlineColor?: string;
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
    /** `raise` steps a filled surface. `brand` darkens chartreuse. `none` leaves today's look. */
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

export function affordanceStyle(
  state: PressState,
  options: { signal?: AffordanceSignal; disabled?: boolean; reduceMotion?: boolean },
): AffordanceStyle | null {
  const signal = options.signal ?? "raise";
  if (signal === "none" || options.disabled) return null;
  const reduce = options.reduceMotion ?? false;
  const pressed = Boolean(state.pressed);
  const base = {
    ...pressMotion(reduce),
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : {}),
  } as AffordanceStyle;
  if (!pressed) return base;
  switch (signal) {
    case "brand":
      return { ...base, backgroundColor: brandPressed };
    case "hairline":
      return { ...base, opacity: pressOpacity };
    case "raise":
      return { ...base, backgroundColor: colors.surface2 };
    default: {
      const exhaustive: never = signal;
      return exhaustive;
    }
  }
}

/** Drop-in Pressable that shows it can be used. `signal="none"` keeps the current look. */
export function Affordance({ style, signal = "raise", disabled, ...rest }: AffordanceProps) {
  const reduce = useReduceMotion();
  const blocked = Boolean(disabled);
  if (signal === "none") {
    return <Pressable {...(rest as PressableProps)} disabled={disabled} style={style} />;
  }
  return (
    <Pressable
      {...(rest as PressableProps)}
      disabled={disabled}
      style={(state) => [
        style,
        affordanceStyle(state as PressState, { signal, disabled: blocked, reduceMotion: reduce }),
      ]}
    />
  );
}
