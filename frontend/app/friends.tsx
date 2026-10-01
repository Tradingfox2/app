import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { api, type StoryGroup } from "@/src/api";
import { Avatar } from "@/src/components/social/avatar";
import { Composer, PostCard, useFeed } from "@/src/components/social/feed";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing, type } from "@/src/theme";

/** Posts and workout stories from people you follow. Not the public community feed. */
export default function FriendsFeed() {
  const router = useRouter();
  const { t } = useI18n();
  const feed = useFeed({}, "friends");
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [storyError, setStoryError] = useState("");

  const loadStories = useCallback(() => {
    api.storyFeed()
      .then(rows => { setGroups(rows); setStoryError(""); })
      .catch(cause => setStoryError(cause instanceof Error ? cause.message : t("Something went wrong")));
  }, [t]);

  useFocusEffect(useCallback(() => {
    void feed.load("friends");
    loadStories();
    return () => feed.stop();
    // feed.load identity changes with scope; this screen stays on friends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStories]));

  return <SafeAreaView style={styles.safe} testID="friends-screen">
    <View style={styles.header}>
      <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance>
      <Text style={styles.title} accessibilityLabel={t("Friends feed")}>{t("FRIENDS")}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.hint}>{t("Posts from people you follow. Not your Following list. A friends-only post stays off the public feed.")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tray} testID="friends-stories">
        <Affordance accessibilityRole="button" testID="friends-create-story" onPress={() => router.push("/story-new" as Href)} style={styles.add}>
          <Ionicons name="add" size={18} color={colors.text} />
          <Text style={styles.addText}>{t("YOUR STORY")}</Text>
        </Affordance>
        {groups.map(group => {
          const authorId = group.author?.id;
          if (!authorId) return null;
          const latest = group.stories[group.stories.length - 1];
          return <Affordance key={authorId} accessibilityRole="button" testID={`friends-story-${authorId}`} onPress={() => router.push({ pathname: "/story/[authorId]", params: { authorId, kind: "stories" } })} style={styles.bubble}>
            <Avatar user={group.author} size={52} />
            <Text style={styles.bubbleName} numberOfLines={1}>{group.author?.full_name || t("Member")}</Text>
            {latest?.workout_summary?.title ? <Text style={styles.bubbleMeta} numberOfLines={1}>{latest.workout_summary.title}</Text> : null}
          </Affordance>;
        })}
      </ScrollView>
      {storyError ? <Text accessibilityRole="alert" style={styles.error}>{storyError}</Text> : null}
      {!storyError && groups.length === 0 ? <Text style={styles.hint}>{t("No stories from people you follow.")}</Text> : null}
      <View testID="friends-feed">
        <Composer personal onPublished={created => { if (created.audience !== "only_me") feed.prepend(created); }} />
        {feed.loading ? <ActivityIndicator color={colors.text} /> : null}
        {feed.error ? <Text accessibilityRole="alert" style={styles.error}>{feed.error}</Text> : null}
        {!feed.loading && !feed.error && feed.posts.length === 0 ? <Text style={styles.hint}>{t("Follow athletes and coaches to build your feed")}</Text> : null}
        {feed.posts.map(post => <PostCard key={post.id} post={post} onChange={next => feed.patch(post.id, () => next)} onRemoved={() => feed.remove(post.id)} onReposted={created => feed.prepend(created)} />)}
        {feed.hasMore ? <Affordance accessibilityRole="button" onPress={() => void feed.loadMore()} style={styles.more}><Text style={styles.moreText}>{t("LOAD MORE")}</Text></Affordance> : null}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { height: 64, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { ...type.section, color: colors.text, flex: 1 },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  tray: { gap: spacing.md, paddingVertical: spacing.sm, alignItems: "flex-start" },
  add: { width: 76, minHeight: 88, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", gap: 4, padding: spacing.sm },
  addText: { color: colors.text, fontSize: 11, fontWeight: "600", textAlign: "center" },
  bubble: { width: 84, alignItems: "center", gap: 4 },
  bubbleName: { color: colors.text, fontSize: 11, fontWeight: "700", maxWidth: 84 },
  bubbleMeta: { color: colors.textDim, fontSize: 10, maxWidth: 84 },
  error: { color: colors.error },
  more: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  moreText: { color: colors.text, fontWeight: "900" },
});
