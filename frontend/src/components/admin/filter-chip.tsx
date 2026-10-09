import type { ReactNode } from "react";
import { Text } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { selectedControl } from "@/src/community-copy";
import { consoleStyles as styles } from "./console-styles";

/** Selected filters use the chartreuse border and label. Unselected stays neutral. */
export function FilterChip({
  label,
  selected,
  onPress,
  testID,
  children,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  children?: ReactNode;
}) {
  return (
    <Affordance
      accessibilityRole="button"
      accessibilityLabel={label}
      {...selectedControl(selected)}
      testID={testID}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipActive]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{children ?? label}</Text>
    </Affordance>
  );
}
