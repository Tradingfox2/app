import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Svg, { Ellipse, Circle, Rect } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "@/src/theme";

type Props = {
  volumes: Record<string, number>;
  max: number;
  onPress?: () => void;
};

/**
 * Color-code a muscle region based on its normalized volume.
 * dim → warm → hot (brand lime).
 */
function shade(vol: number, max: number): string {
  if (!max || !vol) return colors.surface3;
  const t = Math.min(1, vol / max);
  if (t < 0.15) return "#3a3a1a";
  if (t < 0.35) return "#6a7c1a";
  if (t < 0.65) return "#a5c800";
  return colors.brand;
}

/**
 * Very stylized front / back body silhouette. Each region uses an ellipse or
 * rectangle whose fill is the intensity color. Purely presentational.
 */
function BodyFront({ volumes, max }: Props) {
  const c = (k: string) => shade(volumes[k] || 0, max);
  return (
    <Svg width={130} height={280} viewBox="0 0 130 280">
      {/* head */}
      <Circle cx="65" cy="22" r="16" fill={colors.surface3} />
      {/* neck */}
      <Rect x="58" y="34" width="14" height="10" fill={colors.surface3} />
      {/* shoulders */}
      <Ellipse cx="38" cy="52" rx="14" ry="10" fill={c("shoulders")} />
      <Ellipse cx="92" cy="52" rx="14" ry="10" fill={c("shoulders")} />
      {/* chest */}
      <Ellipse cx="52" cy="70" rx="14" ry="14" fill={c("chest")} />
      <Ellipse cx="78" cy="70" rx="14" ry="14" fill={c("chest")} />
      {/* biceps */}
      <Ellipse cx="28" cy="80" rx="8" ry="18" fill={c("biceps")} />
      <Ellipse cx="102" cy="80" rx="8" ry="18" fill={c("biceps")} />
      {/* forearms */}
      <Ellipse cx="22" cy="115" rx="7" ry="16" fill={c("forearms")} />
      <Ellipse cx="108" cy="115" rx="7" ry="16" fill={c("forearms")} />
      {/* abs */}
      <Rect x="52" y="88" width="26" height="42" rx="4" fill={c("abs")} />
      {/* obliques */}
      <Ellipse cx="46" cy="118" rx="5" ry="14" fill={c("obliques")} />
      <Ellipse cx="84" cy="118" rx="5" ry="14" fill={c("obliques")} />
      {/* quads */}
      <Ellipse cx="52" cy="170" rx="12" ry="30" fill={c("quads")} />
      <Ellipse cx="78" cy="170" rx="12" ry="30" fill={c("quads")} />
      {/* calves front / shins are neutral */}
      <Ellipse cx="52" cy="230" rx="9" ry="22" fill={colors.surface3} />
      <Ellipse cx="78" cy="230" rx="9" ry="22" fill={colors.surface3} />
    </Svg>
  );
}

function BodyBack({ volumes, max }: Props) {
  const c = (k: string) => shade(volumes[k] || 0, max);
  return (
    <Svg width={130} height={280} viewBox="0 0 130 280">
      {/* head */}
      <Circle cx="65" cy="22" r="16" fill={colors.surface3} />
      <Rect x="58" y="34" width="14" height="10" fill={colors.surface3} />
      {/* traps + upper back */}
      <Rect x="45" y="46" width="40" height="18" rx="6" fill={c("back")} />
      {/* rear shoulders */}
      <Ellipse cx="34" cy="54" rx="12" ry="9" fill={c("shoulders")} />
      <Ellipse cx="96" cy="54" rx="12" ry="9" fill={c("shoulders")} />
      {/* lats */}
      <Ellipse cx="48" cy="82" rx="12" ry="18" fill={c("lats")} />
      <Ellipse cx="82" cy="82" rx="12" ry="18" fill={c("lats")} />
      {/* triceps */}
      <Ellipse cx="26" cy="82" rx="8" ry="18" fill={c("triceps")} />
      <Ellipse cx="104" cy="82" rx="8" ry="18" fill={c("triceps")} />
      {/* forearms */}
      <Ellipse cx="22" cy="115" rx="7" ry="16" fill={c("forearms")} />
      <Ellipse cx="108" cy="115" rx="7" ry="16" fill={c("forearms")} />
      {/* lower back */}
      <Rect x="52" y="108" width="26" height="24" rx="4" fill={c("lower_back")} />
      {/* glutes */}
      <Ellipse cx="52" cy="150" rx="14" ry="16" fill={c("glutes")} />
      <Ellipse cx="78" cy="150" rx="14" ry="16" fill={c("glutes")} />
      {/* hamstrings */}
      <Ellipse cx="52" cy="192" rx="12" ry="26" fill={c("hamstrings")} />
      <Ellipse cx="78" cy="192" rx="12" ry="26" fill={c("hamstrings")} />
      {/* calves */}
      <Ellipse cx="52" cy="242" rx="10" ry="22" fill={c("calves")} />
      <Ellipse cx="78" cy="242" rx="10" ry="22" fill={c("calves")} />
    </Svg>
  );
}

export function MuscleHeatmap({ volumes, max, onPress }: Props) {
  const content = (
    <>
      <View style={styles.bodies}>
        <View style={styles.bodyBlock}>
          <BodyFront volumes={volumes} max={max} />
          <Text style={styles.bodyLbl}>FRONT</Text>
        </View>
        <View style={styles.bodyBlock}>
          <BodyBack volumes={volumes} max={max} />
          <Text style={styles.bodyLbl}>BACK</Text>
        </View>
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendTxt}>LOW</Text>
        <View style={[styles.legendChip, { backgroundColor: "#3a3a1a" }]} />
        <View style={[styles.legendChip, { backgroundColor: "#6a7c1a" }]} />
        <View style={[styles.legendChip, { backgroundColor: "#a5c800" }]} />
        <View style={[styles.legendChip, { backgroundColor: colors.brand }]} />
        <Text style={styles.legendTxt}>HIGH</Text>
      </View>
      {onPress && (
        <View style={styles.explorePrompt}>
          <Text style={styles.exploreText}>Explore muscles</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accent} />
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        style={styles.wrap}
        testID="muscle-heatmap"
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Open muscle explorer"
        accessibilityHint="View detailed muscle training status and exercises"
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap} testID="muscle-heatmap">
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  bodies: { flexDirection: "row", gap: spacing.lg },
  bodyBlock: { alignItems: "center" },
  bodyLbl: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.md,
  },
  legendTxt: { color: colors.textMuted, fontSize: 10, letterSpacing: 1 },
  legendChip: { width: 14, height: 10, borderRadius: 2 },
  explorePrompt: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  exploreText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "600",
  },
});
