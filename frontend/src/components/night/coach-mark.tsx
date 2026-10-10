import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/src/theme";
import { EquipmentGlyph, IronflowMark } from "@/src/components/night/plate-glyphs";

type CoachMarkProps = {
  size?: number;
  /** Visible “Coach” eyebrow already names the role, so the mark is not a second description. */
  labeled?: boolean;
};

/** Member monogram inside the existing circle. Decorative when the eyebrow already says Coach. */
export function CoachMark({ size = 48, labeled = true }: CoachMarkProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.surface3,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
      accessibilityLabel={labeled ? undefined : "Coach, ready for today's session."}
      accessibilityElementsHidden={labeled}
      importantForAccessibility={labeled ? "no" : "yes"}
    >
      <IronflowMark size={Math.round(size * 0.62)} />
    </View>
  );
}

export function PosterPlate({
  name,
  equipment,
  compact = false,
}: {
  name: string;
  equipment?: string | null;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <View style={poster.compact}>
        <EquipmentGlyph equipment={equipment} size={40} />
      </View>
    );
  }
  return (
    <View style={poster.plate}>
      <EquipmentGlyph equipment={equipment} size={56} />
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
  compact: {
    width: 84,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.surface3,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  name: { ...type.section, textAlign: "center" },
});
