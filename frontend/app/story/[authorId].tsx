import { useCallback, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, mediaUrl, type Story, type WorkoutSummary } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing, type } from "@/src/theme";

function Summary({ summary }: { summary: WorkoutSummary }) {
  const { t, formatNumber } = useI18n();
  const minutes = summary.duration_sec ? Math.round(summary.duration_sec / 60) : null;
  return <View style={styles.summary} testID="story-workout">
    <Text style={styles.summaryTitle}>{summary.title}</Text>
    <Text style={styles.meta}>
      {t("{sets} sets · {kg} kg", { sets: formatNumber(summary.sets), kg: formatNumber(summary.tonnage_kg) })}
      {minutes !== null ? ` · ${minutes} min` : ""}
    </Text>
    {summary.exercises.length ? <Text style={styles.meta}>{summary.exercises.join(" · ")}</Text> : null}
  </View>;
}

/** One person's active stories, or their saved workout highlights. */
export default function StoryViewer() {
  const { authorId, kind } = useLocalSearchParams<{ authorId: string; kind?: string }>();
  const highlights = kind === "highlights";
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const [rows, setRows] = useState<Story[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!authorId) return;
    setLoading(true); setError("");
    try {
      const next = highlights ? await api.userHighlights(authorId) : await api.userStories(authorId);
      setRows(next);
      setIndex(0);
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { setLoading(false); }
  }, [authorId, highlights, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const story = rows[index] ?? null;
  const own = story?.author_id === user?.id;
  const image = story?.media.find(item => item.kind === "image");

  const remove = async () => {
    if (!story) return;
    try {
      await api.deleteStory(story.id);
      const next = rows.filter(row => row.id !== story.id);
      setRows(next);
      setIndex(current => Math.max(0, Math.min(current, next.length - 1)));
      if (next.length === 0) router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    }
  };

  return <SafeAreaView style={styles.safe} testID="story-viewer">
    <View style={styles.header}>
      <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance>
      <Text style={styles.title}>{highlights ? t("HIGHLIGHTS") : t("STORY")}</Text>
      {own && story ? <Affordance accessibilityRole="button" testID="story-delete" onPress={() => void remove()} style={styles.icon}><Ionicons name="trash-outline" size={18} color={colors.error} /></Affordance> : <View style={styles.icon} />}
    </View>
    {loading ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!loading && !story && !error ? <Text style={styles.empty} testID="story-empty">{t("This story is no longer available.")}</Text> : null}
    {story ? <View style={styles.card} testID={`story-${story.id}`}>
      <Text style={styles.author}>{story.author?.full_name || t("Member")}</Text>
      {story.highlight_title ? <Text style={styles.kicker}>{story.highlight_title}</Text> : null}
      {story.audience === "friends" ? <Text style={styles.meta}>{t("Friends")}</Text> : null}
      {image ? <Image source={{ uri: mediaUrl(image.url) }} style={styles.image} accessibilityIgnoresInvertColors /> : null}
      {story.workout_summary ? <Summary summary={story.workout_summary} /> : null}
      {story.caption ? <Text style={styles.caption}>{story.caption}</Text> : null}
      <View style={styles.nav}>
        <Affordance accessibilityRole="button" accessibilityLabel={t("Previous")} testID="story-previous" disabled={index === 0} onPress={() => setIndex(current => Math.max(0, current - 1))} style={[styles.navBtn, index === 0 && styles.disabled]}><Text style={styles.navText}>{t("Previous")}</Text></Affordance>
        <Text style={styles.meta}>{index + 1}/{rows.length}</Text>
        <Affordance accessibilityRole="button" accessibilityLabel={t("Next")} testID="story-next" disabled={index >= rows.length - 1} onPress={() => setIndex(current => Math.min(rows.length - 1, current + 1))} style={[styles.navBtn, index >= rows.length - 1 && styles.disabled]}><Text style={styles.navText}>{t("Next")}</Text></Affordance>
      </View>
    </View> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { height: 64, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { ...type.section, color: colors.text, flex: 1 },
  error: { color: colors.error, padding: spacing.lg },
  empty: { color: colors.textMuted, padding: spacing.lg, textAlign: "center" },
  card: { padding: spacing.lg, gap: spacing.md },
  author: { color: colors.text, fontWeight: "900", fontSize: 18 },
  kicker: { color: colors.text, fontWeight: "800", letterSpacing: 0.4 },
  meta: { color: colors.textDim, fontSize: 12 },
  image: { width: "100%", height: 280, borderRadius: radius.md, backgroundColor: colors.surface2 },
  summary: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface2, gap: 4 },
  summaryTitle: { color: colors.text, fontWeight: "900" },
  caption: { color: colors.text, lineHeight: 22 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  navBtn: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  navText: { color: colors.text, fontWeight: "800" },
  disabled: { opacity: 0.35 },
});
