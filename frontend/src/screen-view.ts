import { useEffect } from "react";
import { usePathname } from "expo-router";
import { track } from "./analytics";

type TabScreen = "home" | "workouts" | "community" | "profile";

/** Tab route name. Query strings, hashes, and route groups are left out. */
export function tabScreenName(pathname: string): TabScreen | null {
  const bare = pathname.split("?")[0].split("#")[0];
  const parts = bare.split("/").filter(part => part.length > 0 && !part.startsWith("("));
  if (parts.length !== 1) return null;
  switch (parts[0]) {
    case "home":
    case "workouts":
    case "community":
    case "profile":
      return parts[0];
    default:
      return null;
  }
}

/** `screen_view` for the signed-in tab shell (home, workouts, community, profile). */
export function useShellScreenView(enabled: boolean) {
  const pathname = usePathname();
  useEffect(() => {
    if (!enabled) return;
    const screen = tabScreenName(pathname);
    if (!screen) return;
    track("screen_view", { screen });
  }, [enabled, pathname]);
}
