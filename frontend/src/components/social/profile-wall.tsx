import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { api, mediaUrl, type ProfilePhoto, type PublicProfile as Profile, type Story } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { limitedAudienceLabel } from "@/src/audience-copy";
import { Avatar } from "@/src/components/social/avatar";
import { Composer, PostCard, useFeed } from "@/src/components/social/feed";
import { ReportSheet, type ReportTarget } from "@/src/components/social/report-sheet";

type WallTab = "posts" | "photos" | "about";

function wallLabel(tab: WallTab): string {
  switch (tab) {
    case "posts": return "POSTS";
    case "photos": return "PHOTOS";
    case "about": return "ABOUT";
    default: {
      const unreachable: never = tab;
      return unreachable;
    }
  }
}

type ProfileWallProps = {
  userId: string;
  /** The You tab has no back control. A pushed profile does. */
  variant: "tab" | "screen";
};

/**
 * One athlete wall, used by the You tab and by `/user/[id]`.
 * Stories and highlights sit at the top. Settings stay behind the gear.
 */
export function ProfileWall({ userId, variant }: ProfileWallProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { t, formatNumber } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const busyRef = useRef(false);
  const own = user?.id === userId;

  const load = useCallback(async () => {
    if (!userId) return;
    const current = ++revision.current;
    setError("");
    try {
      const row = await api.publicProfile(userId);
      if (!row?.id) throw new Error(t("Something went wrong"));
      if (current === revision.current) setProfile(row);
    } catch (cause) {
      if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    }
  }, [userId, t]);

  useFocusEffect(useCallback(() => {
    setProfile(null);
    void load();
    return () => { revision.current += 1; };
  }, [load]));

  const posts = useFeed({ author_id: userId });
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [wallTab, setWallTab] = useState<WallTab>("posts");
  const [stories, setStories] = useState<Story[]>([]);
  const [highlights, setHighlights] = useState<Story[]>([]);
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const canSeePosts = !!profile?.can_view_posts && !profile?.is_blocked;

  useEffect(() => {
    if (canSeePosts && userId) {
      void posts.load();
      setStories([]);
      setHighlights([]);
      setPhotos([]);
      let cancelled = false;
      Promise.all([
        api.userStories(userId).catch(() => [] as Story[]),
        api.userHighlights(userId).catch(() => [] as Story[]),
        api.profilePhotos(userId).catch(() => [] as ProfilePhoto[]),
      ]).then(([nextStories, nextHighlights, nextPhotos]) => {
        if (cancelled) return;
        setStories(nextStories);
        setHighlights(nextHighlights);
        setPhotos(nextPhotos);
      });
      return () => { cancelled = true; posts.stop(); };
    }
    return () => posts.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feed helpers are stable per profile
  }, [canSeePosts, userId]);

  const act = async (action: () => Promise<unknown>) => {
    if (!profile || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const toggleFollow = () => act(() =>
    profile!.follow_state === "none" ? api.follow(profile!.id) : api.unfollow(profile!.id));
  const toggleBlock = () => act(() =>
    profile!.is_blocked ? api.unblockUser(profile!.id) : api.blockUser(profile!.id));
  const toggleMute = () => act(() =>
    profile!.is_muted ? api.unmuteUser(profile!.id) : api.muteUser(profile!.id));
  const [menuOpen, setMenuOpen] = useState(false);
  const profileOwn = profile?.id === user?.id;
  const followLabel = profile?.follow_state === "following" ? "FOLLOWING"
    : profile?.follow_state === "pending" ? "REQUESTED" : "FOLLOW";
  const openConnections = (tab: "followers" | "following") => {
    if (!profile?.can_view_posts) return;
    router.push({ pathname: "/user/connections", params: { id: profile.id, tab, name: profile.full_name || "" } });
  };

  return (
    <SafeAreaView edges={variant === "tab" ? ["top"] : undefined} style={styles.safe} testID={variant === "tab" ? "profile-screen" : undefined}>
      <View style={styles.header}>
        {variant === "screen" ? (
          <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}>
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </Pressable>
        ) : null}
        <Text style={styles.headerTitle}>{variant === "tab" ? t("You") : t("PROFILE")}</Text>
        {own ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("SETTINGS")} testID="open-settings" onPress={() => router.push("/settings" as Href)} style={styles.icon}>
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Pressable>
        ) : <View style={styles.icon} />}
      </View>
      {own ? (
        <View style={styles.shortcuts}>
          <Pressable accessibilityRole="button" testID="edit-profile" onPress={() => router.push("/profile-edit")} style={styles.shortcut}>
            <Ionicons name="create-outline" size={16} color={colors.brand} />
            <Text style={styles.shortcutText}>{t("EDIT PROFILE")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" testID="open-saved" onPress={() => router.push("/saved")} style={styles.shortcut}>
            <Ionicons name="bookmark-outline" size={16} color={colors.brand} />
            <Text style={styles.shortcutText}>{t("SAVED POSTS")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Friends feed")} testID="open-friends-feed" onPress={() => router.push("/friends" as Href)} style={styles.shortcut}>
            <Ionicons name="people-outline" size={16} color={colors.brand} />
            <Text style={styles.shortcutText}>{t("FRIENDS")}</Text>
          </Pressable>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.scroll}>
        {error ? (
          <View accessibilityRole="alert">
            <Text style={styles.error}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.icon}>
              <Text style={styles.retry}>{t("Retry")}</Text>
            </Pressable>
          </View>
        ) : null}
        {!profile && !error ? <ActivityIndicator color={colors.brand} /> : null}
        {profile ? (
          <>
            {canSeePosts ? (
              <View testID="profile-activity" style={styles.activity}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={wall.storyRow}>
                  {profileOwn ? (
                    <Pressable accessibilityRole="button" testID="profile-new-story" onPress={() => router.push("/story-new" as Href)} style={wall.storyAdd}>
                      <Ionicons name="add" size={18} color={colors.brandOn} />
                      <Text style={wall.storyAddText}>{t("YOUR STORY")}</Text>
                    </Pressable>
                  ) : null}
                  {stories.map(story => {
                    const mark = limitedAudienceLabel(story.audience);
                    return (
                      <Pressable key={story.id} accessibilityRole="button" testID={`profile-story-${story.id}`} onPress={() => router.push({ pathname: "/story/[authorId]", params: { authorId: profile.id, kind: "stories" } })} style={wall.storyChip}>
                        <Text style={wall.chipText} numberOfLines={1}>{story.workout_summary?.title || t("STORY")}{mark ? ` · ${t(mark)}` : ""}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {(highlights.length > 0 || profileOwn) ? (
                  <View testID="profile-highlights">
                    <Text style={wall.section}>{t("HIGHLIGHTS")}</Text>
                    {highlights.length === 0 ? <Text style={styles.hint}>{t("No highlights yet.")}</Text> : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={wall.storyRow}>
                        {highlights.map(story => {
                          const mark = limitedAudienceLabel(story.audience);
                          return (
                            <Pressable key={story.id} accessibilityRole="button" testID={`profile-highlight-${story.id}`} onPress={() => router.push({ pathname: "/story/[authorId]", params: { authorId: profile.id, kind: "highlights" } })} style={wall.highlight}>
                              <Text style={wall.chipText} numberOfLines={2}>{story.highlight_title || story.workout_summary?.title || t("HIGHLIGHTS")}{mark ? ` · ${t(mark)}` : ""}</Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    )}
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={wall.cover} testID="profile-cover">
              {profile.cover_url ? <Image source={{ uri: mediaUrl(profile.cover_url) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
            </View>
            <Pressable accessibilityRole="button" disabled={stories.length === 0} onPress={() => stories.length > 0 && router.push({ pathname: "/story/[authorId]", params: { authorId: profile.id, kind: "stories" } })} style={styles.avatar}>
              <Avatar user={profile} size={84} />
            </Pressable>
            <Text style={styles.name}>{profile.full_name || t("Member")}</Text>
            {profile.is_coach ? (
              <View style={styles.coachTag} testID="coach-badge">
                <Ionicons name="ribbon" size={11} color={colors.brandOn} />
                <Text style={styles.coachText}>{t("COACH")}</Text>
              </View>
            ) : null}
            {profile.bio ? <Text style={styles.bio} testID="profile-bio">{profile.bio}</Text> : null}
            {profile.sports?.length ? (
              <View style={wall.chips} testID="profile-sports">
                {profile.sports.map(tag => <View key={tag} style={wall.chip}><Text style={wall.chipText}>{tag}</Text></View>)}
              </View>
            ) : null}
            {profile.is_private ? (
              <View style={styles.privateTag}>
                <Ionicons name="lock-closed" size={11} color={colors.textDim} />
                <Text style={styles.privateText}>{t("PRIVATE ACCOUNT")}</Text>
              </View>
            ) : null}
            <View style={styles.stats}>
              <View style={styles.stat}><Text style={styles.statValue}>{formatNumber(profile.posts)}</Text><Text style={styles.statLabel}>{t("POSTS")}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={t("Followers list")} testID="open-followers" onPress={() => openConnections("followers")} style={styles.stat}>
                <Text style={styles.statValue}>{formatNumber(profile.followers)}</Text>
                <Text style={styles.statLabel}>{t("FOLLOWERS")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t("Following list")} testID="open-following" onPress={() => openConnections("following")} style={styles.stat}>
                <Text style={styles.statValue}>{formatNumber(profile.following)}</Text>
                <Text style={styles.statLabel}>{t("FOLLOWING")}</Text>
              </Pressable>
            </View>
            {!profileOwn ? (
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" testID="follow-toggle" disabled={busy} onPress={() => void toggleFollow()} style={[styles.primary, profile.follow_state !== "none" && styles.secondary, busy && styles.disabled]}>
                  <Text style={[styles.primaryText, profile.follow_state !== "none" && styles.secondaryText]}>{t(followLabel)}</Text>
                </Pressable>
                {profile.can_message ? (
                  <Pressable accessibilityRole="button" testID="message-user" onPress={() => router.push({ pathname: "/dm/[id]", params: { id: profile.id, name: profile.full_name || "" } })} style={styles.secondary}>
                    <Ionicons name="chatbubble-outline" size={16} color={colors.text} />
                    <Text style={styles.secondaryText}>{t("MESSAGE")}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel={t("More")} testID="profile-menu" onPress={() => setMenuOpen(open => !open)} style={styles.secondary}>
                  <Ionicons name="ellipsis-horizontal" size={16} color={colors.text} />
                </Pressable>
              </View>
            ) : null}
            {!profileOwn && menuOpen ? (
              <View style={styles.menu} testID="profile-menu-sheet">
                <Pressable accessibilityRole="button" testID="toggle-mute" disabled={busy} onPress={() => void toggleMute()} style={styles.menuRow}>
                  <Ionicons name={profile.is_muted ? "volume-high-outline" : "volume-mute-outline"} size={16} color={colors.text} />
                  <Text style={styles.menuText}>{t(profile.is_muted ? "Unmute" : "Mute")}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" testID="toggle-block" disabled={busy} onPress={() => void toggleBlock()} style={styles.menuRow}>
                  <Ionicons name="ban-outline" size={16} color={colors.error} />
                  <Text style={[styles.menuText, { color: colors.error }]}>{t(profile.is_blocked ? "Unblock" : "Block")}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" testID="report-user" onPress={() => { setMenuOpen(false); setReporting({ target_type: "user", target_id: profile.id }); }} style={styles.menuRow}>
                  <Ionicons name="flag-outline" size={16} color={colors.text} />
                  <Text style={styles.menuText}>{t("Report account")}</Text>
                </Pressable>
                <Text style={styles.menuHint}>{t("Muting hides their posts. Blocking also removes the follow both ways.")}</Text>
              </View>
            ) : null}
            {!profileOwn && profile.is_private && !profile.can_view_posts ? (
              <View style={styles.locked} testID="private-account-notice">
                <Ionicons name="lock-closed-outline" size={28} color={colors.textDim} />
                <Text style={styles.hint}>{t("This account is private. Follow to see their posts.")}</Text>
              </View>
            ) : null}
            {!profileOwn && !profile.can_message ? (
              <Text testID="message-locked" style={styles.hint}>{t(profile.is_blocked ? "This account is unavailable" : "Messaging unlocks when you follow each other, share a community, or have a coaching relationship.")}</Text>
            ) : null}
            {canSeePosts ? (
              <View style={styles.wall}>
                <View style={wall.tabs}>
                  {(["posts", "photos", "about"] as WallTab[]).map(item => (
                    <Pressable key={item} accessibilityRole="button" testID={`profile-tab-${item}`} onPress={() => setWallTab(item)} style={[wall.tab, wallTab === item && wall.tabOn]}>
                      <Text style={[wall.tabText, wallTab === item && wall.tabTextOn]}>{t(wallLabel(item))}</Text>
                    </Pressable>
                  ))}
                </View>
                {wallTab === "posts" ? (
                  <View testID="profile-posts">
                    {profileOwn ? <Composer personal onPublished={created => { posts.prepend(created); setProfile(current => current ? { ...current, posts: current.posts + 1 } : current); }} /> : null}
                    {posts.error ? (
                      <View accessibilityRole="alert" testID="profile-posts-error">
                        <Text style={styles.error}>{posts.error}</Text>
                        <Pressable accessibilityRole="button" testID="profile-posts-retry" onPress={() => void posts.load()}>
                          <Text style={styles.retry}>{t("Retry")}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {!posts.loading && !posts.error && posts.posts.length === 0 ? <Text style={styles.hint}>{t("No posts yet.")}</Text> : null}
                    {posts.posts.map(post => <PostCard key={post.id} post={post} onChange={next => posts.patch(post.id, () => next)} onRemoved={() => posts.remove(post.id)} onReposted={() => undefined} />)}
                    {posts.hasMore ? <Pressable accessibilityRole="button" onPress={() => void posts.loadMore()} style={styles.icon}><Text style={styles.retry}>{t("LOAD MORE")}</Text></Pressable> : null}
                  </View>
                ) : wallTab === "photos" ? (
                  <View style={wall.photoGrid} testID="profile-photos">
                    {photos.length === 0 ? <Text style={styles.hint}>{t("No photos yet.")}</Text> : photos.map(photo => (
                      <Pressable key={`${photo.post_id}-${photo.id}`} accessibilityRole="button" onPress={() => router.push({ pathname: "/post/[id]", params: { id: photo.post_id } })}>
                        <Image source={{ uri: mediaUrl(photo.url) }} style={wall.photo} accessibilityIgnoresInvertColors />
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <View testID="profile-about">
                    <Text style={profile.about ? styles.bio : styles.hint}>{profile.about || (profileOwn ? t("Tell people how you train.") : t("Nothing written yet."))}</Text>
                  </View>
                )}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.section, color: colors.text, flex: 1 },
  shortcuts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  shortcut: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 6 },
  shortcutText: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  scroll: { padding: spacing.lg, alignItems: "center", gap: spacing.md, paddingBottom: spacing.xxxl },
  activity: { alignSelf: "stretch", gap: spacing.md },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: colors.brand, alignItems: "center", justifyContent: "center", marginTop: -36 },
  coachTag: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  coachText: { color: colors.brandOn, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  bio: { color: colors.text, textAlign: "center", maxWidth: 420, lineHeight: 20 },
  wall: { alignSelf: "stretch", borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.lg, gap: spacing.md },
  name: { ...type.screenTitle, fontSize: 24 },
  stats: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.sm },
  stat: { alignItems: "center" },
  statValue: { color: colors.text, fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  statLabel: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  primary: { minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  primaryText: { ...type.button, fontSize: 12 },
  secondary: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: "transparent" },
  secondaryText: { color: colors.text, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  disabled: { opacity: 0.4 },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: "center", maxWidth: 360, lineHeight: 18 },
  error: { color: colors.error },
  retry: { color: colors.brand, fontWeight: "900" },
  privateTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  privateText: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  menu: { alignSelf: "stretch", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, padding: spacing.sm, gap: 2 },
  menuRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  menuText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  menuHint: { color: colors.textDim, fontSize: 11, paddingHorizontal: spacing.sm, paddingBottom: 4, lineHeight: 15 },
  locked: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
});

const wall = StyleSheet.create({
  cover: { alignSelf: "stretch", height: 140, borderRadius: radius.md, backgroundColor: colors.surface2, overflow: "hidden" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
  chip: { minHeight: 28, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandDim, alignItems: "center", justifyContent: "center" },
  chipText: { color: colors.brand, fontSize: 12, fontWeight: "800" },
  storyRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  storyAdd: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brand, flexDirection: "row", alignItems: "center", gap: 4 },
  storyAddText: { color: colors.brandOn, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  storyChip: { maxWidth: 140, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brand, alignItems: "center", justifyContent: "center" },
  section: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginBottom: spacing.sm },
  highlight: { width: 88, minHeight: 64, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: colors.surface2 },
  tabText: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  tabTextOn: { color: colors.text },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  photo: { width: 104, height: 104, borderRadius: radius.sm, backgroundColor: colors.surface2 },
});
