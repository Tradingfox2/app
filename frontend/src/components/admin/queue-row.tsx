import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { consoleStyles as styles } from "./console-styles";

/** One selectable queue row. The label is the accessible name; badges go in `trailing`. */
export function QueueRow({
  label,
  hint,
  onPress,
  testID,
  children,
  trailing,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  testID?: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Affordance accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} testID={testID} onPress={onPress} style={styles.row} {...(hint && Platform.OS === "web" ? { title: hint } : {})}>
      <View style={styles.rowBody}>{children}</View>
      {trailing}
    </Affordance>
  );
}
