import type { ViewStyle } from "react-native";

/**
 * Press and release for phones and tablets.
 * Color and opacity only, eased out inside 100–200ms. No scale, no travel.
 */

export const PRESS_MS = "160ms";

/**
 * Pressed chartreuse. 75% #D6E35A mixed toward #16180C.
 * Same hue, darker. Not a second brand color.
 */
export const brandPressed = "#A6B047";

/** Unfilled controls dim while the finger is down. */
export const pressOpacity = 0.72;

type MotionStyle = ViewStyle & {
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
};

/** Applies on web and on native when the runtime honors transition styles. */
export function pressMotion(reduceMotion: boolean): MotionStyle {
  return {
    transitionProperty: "background-color, opacity",
    transitionDuration: reduceMotion ? "0ms" : PRESS_MS,
    transitionTimingFunction: "ease-out",
  };
}
