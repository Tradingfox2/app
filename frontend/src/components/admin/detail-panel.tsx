import type { ReactNode } from "react";
import { View } from "react-native";
import { consoleStyles as styles } from "./console-styles";

/** Card for a selected account, ticket, or report. */
export function DetailPanel({ children, testID, label }: { children: ReactNode; testID?: string; label?: string }) {
  return (
    <View accessibilityLabel={label} style={styles.card} testID={testID}>
      {children}
    </View>
  );
}
