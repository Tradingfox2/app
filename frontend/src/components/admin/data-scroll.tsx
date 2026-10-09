import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

/**
 * Keeps a wide figure row inside the viewport. The frame is the parent's width,
 * so labels wrap. A child that sets its own min width can still scroll sideways.
 */
export function DataScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={{ width: "100%", maxWidth: "100%" }} contentContainerStyle={{ flexGrow: 1, width: "100%" }}>
      <View style={{ width: "100%", maxWidth: "100%", flexGrow: 1 }}>{children}</View>
    </ScrollView>
  );
}
