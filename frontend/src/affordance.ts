import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import { brandPressed, pressMotion, pressOpacity } from "@/src/press-motion";
import { colors } from "@/src/theme";

/**
 * Press and release for Home, the tab bar, activity, and the recorder.
 * Filled surfaces step to the next dark surface. Unfilled controls dim.
 * Primary chartreuse darkens in place. Disabled controls stay inert.
 */
export type AffordanceVariant = "surface" | "quiet" | "hairline" | "primary" | "mark";

type WebMotionStyle = ViewStyle & {
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
};

export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

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
  if (options.disabled) return null;

  const pressed = state.pressed;
  const style: WebMotionStyle = pressMotion(options.reduceMotion);

  if (!pressed) return style;

  switch (options.variant) {
    case "surface":
      style.backgroundColor = colors.surface2;
      break;
    case "quiet":
    case "hairline":
    case "mark":
      style.opacity = pressOpacity;
      break;
    case "primary":
      style.backgroundColor = brandPressed;
      break;
    default: {
      const neverVariant: never = options.variant;
      return neverVariant;
    }
  }

  return style;
}
