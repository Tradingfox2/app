import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, type Post } from "@/src/api";
import { PostCard } from "@/src/components/social/feed";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";

/** One post with its comments open — where notifications and share links land. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setError("");
    api.getPost(id).then(row => { if (!cancelled) setPost(row); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : t("Something went wrong")); });
    return () => { cancelled = true; };
  }, [id, t]));

  return <SafeAreaView style={styles.safe} testID="post-screen">
    <View style={styles.header}>
      <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance>
      <Text style={styles.title}>{t("POST")}</Text>
    </View>
    <ScrollView>
      {error ? <Text accessibilityRole="alert" style={styles.error} testID="post-error">{error}</Text> : null}
      {!post && !error ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} /> : null}
      {post ? <PostCard post={post} initiallyOpen shareTargets onChange={setPost} onRemoved={() => router.back()} onReposted={() => undefined} /> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontWeight: "900", letterSpacing: 1 },
  error: { color: colors.error, padding: spacing.lg },
});
