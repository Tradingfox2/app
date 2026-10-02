import * as Haptics from "expo-haptics";

/**
 * One short tap when an activity starts, and one when it stops.
 * A missing or rejected haptic must not block the activity.
 */
export function activityEdgeHaptic(): void {
  try {
    const pending = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void Promise.resolve(pending).catch(() => undefined);
  } catch {
    // Haptics off or unavailable. Start and stop still proceed.
  }
}
