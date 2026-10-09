import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { consoleStyles as styles } from "./console-styles";
import { staffColors } from "./staff-theme";

type Tone = "danger" | "warning" | "ok" | "neutral" | "info";

const ICON: Record<Tone, keyof typeof Ionicons.glyphMap> = {
  danger: "alert-circle-outline",
  warning: "time-outline",
  ok: "checkmark-circle-outline",
  neutral: "ellipse-outline",
  info: "information-circle-outline",
};

const INK: Record<Tone, string> = {
  danger: staffColors.error,
  warning: staffColors.warning,
  ok: staffColors.success,
  neutral: staffColors.text,
  info: staffColors.info,
};

/** Icon plus label. Status is never carried by color alone. */
export function StatusBadge({ label, tone, testID }: { label: string; tone: Tone; testID?: string }) {
  return (
    <View accessibilityLabel={label} style={styles.staffTag} testID={testID}>
      <Ionicons name={ICON[tone]} size={12} color={INK[tone]} />
      <Text style={[styles.staffTagText, { color: staffColors.text }]}>{label}</Text>
    </View>
  );
}
