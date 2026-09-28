import { Platform, type PressableProps } from "react-native";
import type { Community } from "@/src/api";

/** One phrase for an open join policy (manage, detail, discover, new, partner). */
export const OPEN_JOIN_LABEL = "Open join";
/** One phrase for a community listed in discovery (manage, new). */
export const LISTED_PUBLICLY_LABEL = "Listed publicly";
/** One save verb for settings, profile, posts, comments, and confirm buttons. */
export const SAVE_LABEL = "Save";
export const SAVED_LABEL = "Saved";

export function joinPolicyPhrase(policy: Community["join_policy"]): string {
  switch (policy) {
    case "open":
      return OPEN_JOIN_LABEL;
    case "approval":
      return "APPROVAL";
    case "paid":
      return "PAID";
    default: {
      const unreachable: never = policy;
      return unreachable;
    }
  }
}

/** Label, short hint, and a web tooltip for icon-only controls. */
export function iconButtonA11y(label: string, hint: string): PressableProps & { title?: string } {
  return {
    accessibilityRole: "button",
    accessibilityLabel: label,
    accessibilityHint: hint,
    ...(Platform.OS === "web" ? { title: label } : {}),
  };
}

/**
 * Selected state for tabs and filter chips.
 * React Native Web does not copy `accessibilityState.selected` onto `aria-selected`.
 */
export function selectedControl(selected: boolean): Pick<PressableProps, "accessibilityState"> & { "aria-selected": boolean } {
  return {
    accessibilityState: { selected },
    "aria-selected": selected,
  };
}
