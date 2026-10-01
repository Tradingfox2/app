import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, type Post } from "@/src/api";
import { PostCard } from "@/src/components/social/feed";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";

const PAGE = 20;

/** Posts the member bookmarked. Private to them; newest save first. */
export default function SavedScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    api.savedPosts().then(rows => { if (!cancelled) { setPosts(rows); setHasMore(rows.length === PAGE); } })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : t("Something went wrong")); });
    return () => { cancelled = true; };
  }, [t]));

  const more = async () => {
    const last = posts?.[posts.length - 1];
    if (!last || busy.current) return;
    busy.current = true;
    try {
      const rows = await api.savedPosts(last.id);
      setPosts(current => [...(current || []), ...rows]); setHasMore(rows.length === PAGE);
    } catch { /* keep what is shown */ } finally { busy.current = false; }
  };

  const patch = (id: string, next: Post) => setPosts(current => (current || []).map(row => row.id === id ? next : row));
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance>
      <Text style={styles.title}>{t("SAVED")}</Text>
    </View>
    <ScrollView>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {posts === null && !error ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} /> : null}
      {posts?.length === 0 ? <Text style={styles.empty} testID="saved-empty">{t("Nothing saved yet. Tap the bookmark on any post to keep it here.")}</Text> : null}
      {/* An unsaved post stays until the next visit, so a mis-tap can be undone in place. */}
      {(posts || []).map(post => <PostCard key={post.id} post={post} onChange={next => patch(post.id, next)}
        onRemoved={() => setPosts(current => (current || []).filter(row => row.id !== post.id))} onReposted={() => undefined} />)}
      {hasMore ? <Affordance accessibilityRole="button" onPress={() => void more()} style={styles.more}><Text style={styles.moreText}>{t("LOAD MORE")}</Text></Affordance> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontWeight: "900", letterSpacing: 1 },
  error: { color: colors.error, padding: spacing.lg },
  empty: { color: colors.textMuted, textAlign: "center", padding: spacing.xl },
  more: { padding: spacing.lg, alignItems: "center" },
  moreText: { color: colors.text, fontWeight: "900", letterSpacing: 1 },
});
