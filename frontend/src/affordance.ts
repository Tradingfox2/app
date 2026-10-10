import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import { colors } from "@/src/theme";
import { brandHover } from "@/src/press-feedback";

/**
 * Hover and press signals for controls that do not already have one.
 * Chartreuse stays on `primary` only. Disabled controls stay inert.
 */
export type AffordanceVariant = "surface" | "quiet" | "hairline" | "primary" | "mark";

type AffordanceState = PressableStateCallbackType & {
  hovered?: boolean;
  focused?: boolean;
};

type WebMotionStyle = ViewStyle & {
  transitionProperty?: string;
  transitionDuration?: string;
  filter?: string;
  outlineColor?: string;
  outlineStyle?: "solid";
  outlineWidth?: number;
  outlineOffset?: number;
};

function focusRing(focused: boolean): WebMotionStyle {
  if (Platform.OS !== "web" || !focused) return {};
  return {
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: colors.text,
    outlineOffset: 2,
  };
}

function readReducedMotion(): boolean {
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return false;
}

export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(readReducedMotion);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        setReduceMotion(Boolean(enabled));
      },
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export function pressableStyle(
  state: PressableStateCallbackType,
  options: {
    variant: AffordanceVariant;
    reduceMotion: boolean;
    disabled?: boolean;
  },
): ViewStyle | null {
  const webState = state as AffordanceState;
  const ring = focusRing(Boolean(webState.focused));
  if (options.disabled) return ring.outlineWidth ? ring : null;

  const hovered = Platform.OS === "web" && Boolean(webState.hovered);
  const pressed = state.pressed;
  const style: WebMotionStyle = { ...ring };

  if (Platform.OS === "web") {
    style.transitionProperty = "background-color, opacity, transform, filter, outline-color";
    style.transitionDuration = options.reduceMotion ? "0ms" : "140ms";
  }

  if (hovered) {
    switch (options.variant) {
      case "surface":
      case "quiet":
        style.backgroundColor = colors.surface2;
        break;
      case "hairline":
        if (!webState.focused) {
          style.outlineColor = colors.border;
          style.outlineStyle = "solid";
          style.outlineWidth = 1;
        }
        break;
      case "primary":
        style.backgroundColor = brandHover;
        break;
      case "mark":
        style.opacity = 0.72;
        break;
      default: {
        const neverVariant: never = options.variant;
        return neverVariant;
      }
    }
  }

  if (pressed) {
    style.opacity = 0.85;
    if (!options.reduceMotion) {
      style.transform = [{ scale: 0.98 }];
    }
  }

  return style;
}
