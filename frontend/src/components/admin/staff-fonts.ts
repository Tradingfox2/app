import { useFonts } from "expo-font";

/** Barlow (OFL) for the staff console. Member screens do not load these files. */
export function useStaffFonts(): readonly [boolean, Error | null] {
  return useFonts({
    Barlow: require("../../../assets/fonts/Barlow-Regular.ttf"),
    BarlowCondensed: require("../../../assets/fonts/BarlowCondensed-SemiBold.ttf"),
  });
}
