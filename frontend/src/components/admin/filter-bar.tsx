import type { ReactNode } from "react";
import { View } from "react-native";
import { consoleStyles as styles } from "./console-styles";

/** Chip row shared by the staff queues. Children keep their own test ids. */
export function FilterBar({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View accessibilityRole="toolbar" accessibilityLabel={label} style={styles.filters}>
      {children}
    </View>
  );
}
