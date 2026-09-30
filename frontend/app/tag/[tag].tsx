import { useCallback } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { PostCard, useFeed } from "@/src/components/social/feed";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";

/** Everything posted with one hashtag that the viewer is allowed to see. */
export default function TagScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const feed = useFeed({ tag });

  useFocusEffect(useCallback(() => {
    void feed.load();
    return () => feed.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feed helpers are stable per tag
  }, [tag]));

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <Text style={styles.title} testID="tag-title">#{tag}</Text>
    </View>
    <ScrollView>
      {feed.loading ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} /> : null}
      {feed.error ? <View accessibilityRole="alert" testID="tag-feed-error" style={styles.errorBox}>
        <Text style={styles.error}>{feed.error}</Text>
        <Pressable accessibilityRole="button" testID="tag-feed-retry" onPress={() => void feed.load()}><Text style={styles.moreText}>{t("Retry")}</Text></Pressable>
      </View> : null}
      {!feed.loading && !feed.error && feed.posts.length === 0 ? <Text style={styles.empty}>{t("No posts with this tag yet.")}</Text> : null}
      {feed.posts.map(post => <PostCard key={post.id} post={post} onChange={next => feed.patch(post.id, () => next)} onRemoved={() => feed.remove(post.id)} onReposted={feed.prepend} />)}
      {feed.hasMore ? <Pressable accessibilityRole="button" onPress={() => void feed.loadMore()} style={styles.more}><Text style={styles.moreText}>{t("LOAD MORE")}</Text></Pressable> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontWeight: "900", fontSize: 18 },
  empty: { color: colors.textMuted, textAlign: "center", padding: spacing.xl },
  errorBox: { alignItems: "center", gap: spacing.sm, padding: spacing.xl },
  error: { color: colors.error, textAlign: "center" },
  more: { padding: spacing.lg, alignItems: "center" },
  moreText: { color: colors.text, fontWeight: "900", letterSpacing: 1 },
});
