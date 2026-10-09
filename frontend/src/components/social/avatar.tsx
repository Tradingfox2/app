import { StyleSheet, Text, View } from "react-native";
import { mediaUrl, type MentionedUser } from "@/src/api";
import { ReliableImage } from "@/src/components/reliable-image";
import { colors } from "@/src/theme";

/** A person's photo, or their initial on the brand tint when they have none. */
export function Avatar({ user, size = 40 }: { user: Pick<MentionedUser, "full_name" | "avatar_url"> | null | undefined; size?: number }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (user?.avatar_url) {
    return <ReliableImage source={{ uri: mediaUrl(user.avatar_url) }} style={[styles.image, box]} accessibilityIgnoresInvertColors />;
  }
  return <View style={[styles.fallback, box]}>
    <Text style={[styles.initial, { fontSize: Math.max(11, size * 0.4) }]}>{(user?.full_name || "?").charAt(0).toUpperCase()}</Text>
  </View>;
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.surface2 },
  fallback: { backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  initial: { color: colors.text, fontWeight: "900" },
});
