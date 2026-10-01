import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { api, type StoryGroup } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";
import { Avatar } from "./avatar";

/** Active workout stories from you and people you follow. */
export function StoriesTray() {
  const router = useRouter();
  const { t } = useI18n();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.storyFeed()
      .then(rows => { setGroups(rows); setError(""); })
      .catch(cause => setError(cause instanceof Error ? cause.message : t("Something went wrong")));
  }, [t]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return <View testID="community-stories">
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tray}>
      <Affordance accessibilityRole="button" testID="community-create-story" onPress={() => router.push("/story-new" as Href)} style={styles.add}>
        <Ionicons name="add" size={18} color={colors.text} />
        <Text style={styles.addText}>{t("YOUR STORY")}</Text>
      </Affordance>
      {groups.map(group => {
        const authorId = group.author?.id;
        if (!authorId) return null;
        const latest = group.stories[group.stories.length - 1];
        return <Affordance key={authorId} accessibilityRole="button" testID={`community-story-${authorId}`} onPress={() => router.push({ pathname: "/story/[authorId]", params: { authorId, kind: "stories" } })} style={styles.bubble}>
          <Avatar user={group.author} size={52} />
          <Text style={styles.bubbleName} numberOfLines={1}>{group.author?.full_name || t("Member")}</Text>
          {latest?.workout_summary?.title ? <Text style={styles.bubbleMeta} numberOfLines={1}>{latest.workout_summary.title}</Text> : null}
        </Affordance>;
      })}
    </ScrollView>
    {error ? <View accessibilityRole="alert" testID="community-stories-error">
      <Text style={styles.error}>{error}</Text>
      <Affordance accessibilityRole="button" testID="community-stories-retry" onPress={load}><Text style={styles.retry}>{t("Retry")}</Text></Affordance>
    </View> : null}
    {!error && groups.length === 0 ? <Text style={styles.hint}>{t("No stories from people you follow.")}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  tray: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: "flex-start" },
  add: { width: 76, minHeight: 88, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", gap: 4, padding: spacing.sm },
  addText: { color: colors.text, fontSize: 11, fontWeight: "600", textAlign: "center" },
  bubble: { width: 84, alignItems: "center", gap: 4 },
  bubbleName: { color: colors.text, fontSize: 11, fontWeight: "700", maxWidth: 84 },
  bubbleMeta: { color: colors.textDim, fontSize: 10, maxWidth: 84 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18, paddingHorizontal: spacing.lg },
  error: { color: colors.text, backgroundColor: colors.errorWash, padding: spacing.md, marginHorizontal: spacing.lg, borderRadius: radius.sm },
  retry: { color: colors.text, fontWeight: "800", paddingHorizontal: spacing.lg },
});
