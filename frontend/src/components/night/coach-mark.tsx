import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/src/theme";

const mark = require("../../../assets/images/icon.png");

type CoachMarkProps = {
  size?: number;
  /** Visible “Coach” eyebrow already names the role, so the image is not a second description. */
  labeled?: boolean;
};

/**
 * Existing app icon, labeled as a placeholder.
 * Night Studio does not invent a person or load the design-reference drawings.
 */
export function CoachMark({ size = 48, labeled = true }: CoachMarkProps) {
  return (
    <Image
      source={mark}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface3 }}
      contentFit="cover"
      accessibilityLabel={labeled ? undefined : "Coach, ready for today's session."}
      accessibilityElementsHidden={labeled}
      importantForAccessibility={labeled ? "no" : "yes"}
    />
  );
}

export const posterPlaceholder = mark;

export function PosterPlate({ name, compact = false }: { name: string; compact?: boolean }) {
  if (compact) {
    return (
      <View style={poster.compact}>
        <Image source={mark} style={poster.compactImage} contentFit="contain" accessibilityElementsHidden importantForAccessibility="no" />
        <Text style={poster.compactKicker} numberOfLines={1}>Placeholder</Text>
      </View>
    );
  }
  return (
    <View style={poster.plate}>
      <Image source={mark} style={poster.image} contentFit="contain" accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={poster.kicker}>Placeholder</Text>
      <Text style={poster.name} numberOfLines={2}>{name}</Text>
    </View>
  );
}

const poster = StyleSheet.create({
  plate: {
    height: 168,
    backgroundColor: colors.surface3,
    alignItems: "center",
    justifyContent: "flex-end",
    padding: spacing.md,
    gap: spacing.xs,
  },
  image: { width: 56, height: 56, opacity: 0.85 },
  compact: {
    width: 84,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.surface3,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 4,
    gap: 2,
  },
  compactImage: { width: 22, height: 22, opacity: 0.85 },
  compactKicker: { color: colors.textDim, fontSize: 12, lineHeight: 14 },
  kicker: { ...type.caption, color: colors.textDim, fontSize: 11 },
  name: { ...type.section, textAlign: "center" },
});
