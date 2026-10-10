import { router } from "expo-router";

/** Stack back when history exists. A cold open returns to Home. */
export function leaveOrHome(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)/home");
}
