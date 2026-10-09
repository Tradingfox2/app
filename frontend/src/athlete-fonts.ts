import { useFonts } from "expo-font";

/**
 * Bundled SIL Open Font License faces for the member app.
 * Barlow and Barlow Condensed are the Barlow Project. Space Mono is the
 * numeric face. Satoshi is not licensed here. Inter is not loaded from a CDN.
 * Staff loads its own Barlow family names from `staff-fonts.ts`.
 */
export function useAthleteFonts(): readonly [boolean, Error | null] {
  return useFonts({
    IronflowDisplay: require("../assets/fonts/BarlowCondensed-SemiBold.ttf"),
    IronflowDisplayStrong: require("../assets/fonts/BarlowCondensed-Bold.ttf"),
    IronflowText: require("../assets/fonts/Barlow-Regular.ttf"),
    IronflowTextStrong: require("../assets/fonts/Barlow-SemiBold.ttf"),
    IronflowNumeric: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
}
