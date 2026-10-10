import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/src/theme";

type MeterRowProps = {
  value: number | null;
  figure?: string;
  max: number;
  label: string;
  unit?: string;
  caption?: string;
  testID?: string;
};

/** Quiet ledger row. The caption carries the status. The track does not. */
export function MeterRow({ value, figure, max, label, unit, caption, testID }: MeterRowProps) {
  const empty = value === null;
  const shown = figure ?? (empty ? "—" : String(Math.round(value)));
  const pct = empty || max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const accessible = [label, shown, unit, caption].filter((part) => part && part.length > 0).join(", ");
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessible}
      style={styles.row}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.inner}>
        <Text style={styles.name}>{label}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
        <View style={styles.figure}>
          <Text style={styles.value}>
            {shown}
            {unit ? <Text style={styles.unit}> {unit}</Text> : null}
          </Text>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, justifyContent: "center" },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  name: {
    width: 92,
    color: colors.textMuted,
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  track: {
    flex: 1,
    height: 2,
    backgroundColor: colors.borderStrong,
    borderRadius: 1,
    overflow: "hidden",
  },
  fill: {
    backgroundColor: colors.text,
    height: 2,
  },
  figure: { flex: 1 },
  value: { ...type.metric, fontSize: 22 },
  unit: { color: colors.textMuted, fontSize: 12 },
  caption: { color: colors.textDim, fontSize: 12, lineHeight: 16, marginTop: 2 },
});
