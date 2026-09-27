import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, type PublicProfile as Profile } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { Avatar } from "@/src/components/social/avatar";
import { Composer, PostCard, useFeed } from "@/src/components/social/feed";
import { ReportSheet, type ReportTarget } from "@/src/components/social/report-sheet";

export default function PublicProfile() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { user } = useAuth(); const { t, formatNumber } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const revision = useRef(0); const busyRef = useRef(false);
  const load = useCallback(async () => {
    if (!id) return; const current = ++revision.current; setError("");
    try { const row = await api.publicProfile(id); if (current === revision.current) setProfile(row); }
    catch (cause) { if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
  }, [id, t]);
  useFocusEffect(useCallback(() => { setProfile(null); void load(); return () => { revision.current += 1; }; }, [load]));
  const posts = useFeed({ author_id: id });
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const canSeePosts = !!profile?.can_view_posts && !profile?.is_blocked;
  // Their posts load once we know they are visible — a private account's
  // wall would only answer 403.
  useEffect(() => {
    if (canSeePosts) void posts.load();
    return () => posts.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feed helpers are stable per profile
  }, [canSeePosts, id]);
  const act = async (action: () => Promise<unknown>) => {
    if (!profile || busyRef.current) return; busyRef.current = true; setBusy(true);
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busyRef.current = false; setBusy(false); }
  };
  // One control, three meanings: follow, withdraw a request, or unfollow.
  const toggleFollow = () => act(() =>
    profile!.follow_state === "none" ? api.follow(profile!.id) : api.unfollow(profile!.id));
  const toggleBlock = () => act(() =>
    profile!.is_blocked ? api.unblockUser(profile!.id) : api.blockUser(profile!.id));
  const toggleMute = () => act(() =>
    profile!.is_muted ? api.unmuteUser(profile!.id) : api.muteUser(profile!.id));
  const [menuOpen, setMenuOpen] = useState(false);
  const own = profile?.id === user?.id;
  const followLabel = profile?.follow_state === "following" ? "FOLLOWING"
    : profile?.follow_state === "pending" ? "REQUESTED" : "FOLLOW";
  const openConnections = (tab: "followers" | "following") => {
    if (!profile?.can_view_posts) return;  // a private account hides its graph
    router.push({ pathname: "/user/connections", params: { id: profile.id, tab, name: profile.full_name || "" } });
  };
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.headerTitle}>{t("PROFILE")}</Text></View>
    <ScrollView contentContainerStyle={styles.scroll}>
      {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.icon}><Text style={styles.retry}>{t("Retry")}</Text></Pressable></View> : null}
      {!profile && !error ? <ActivityIndicator color={colors.brand} /> : null}
      {profile ? <>
        <View style={styles.avatar}><Avatar user={profile} size={84} /></View>
        <Text style={styles.name}>{profile.full_name || t("Member")}</Text>
        {profile.is_coach ? <View style={styles.coachTag} testID="coach-badge"><Ionicons name="ribbon" size={11} color={colors.brandOn} /><Text style={styles.coachText}>{t("COACH")}</Text></View> : null}
        {profile.bio ? <Text style={styles.bio} testID="profile-bio">{profile.bio}</Text> : null}
        {profile.is_private ? <View style={styles.privateTag}><Ionicons name="lock-closed" size={11} color={colors.textDim} /><Text style={styles.privateText}>{t("PRIVATE ACCOUNT")}</Text></View> : null}
        <View style={styles.stats}>
          <View style={styles.stat}><Text style={styles.statValue}>{formatNumber(profile.posts)}</Text><Text style={styles.statLabel}>{t("POSTS")}</Text></View>
          <Pressable accessibilityRole="button" testID="open-followers" onPress={() => openConnections("followers")} style={styles.stat}><Text style={styles.statValue}>{formatNumber(profile.followers)}</Text><Text style={styles.statLabel}>{t("FOLLOWERS")}</Text></Pressable>
          <Pressable accessibilityRole="button" testID="open-following" onPress={() => openConnections("following")} style={styles.stat}><Text style={styles.statValue}>{formatNumber(profile.following)}</Text><Text style={styles.statLabel}>{t("FOLLOWING")}</Text></Pressable>
        </View>
        {!own ? <View style={styles.actions}>
          <Pressable accessibilityRole="button" testID="follow-toggle" disabled={busy} onPress={() => void toggleFollow()} style={[styles.primary, profile.follow_state !== "none" && styles.secondary, busy && styles.disabled]}><Text style={[styles.primaryText, profile.follow_state !== "none" && styles.secondaryText]}>{t(followLabel)}</Text></Pressable>
          <Pressable accessibilityRole="button" testID="message-user" disabled={!profile.can_message} onPress={() => router.push({ pathname: "/dm/[id]", params: { id: profile.id, name: profile.full_name || "" } })} style={[styles.secondary, !profile.can_message && styles.disabled]}><Ionicons name="chatbubble-outline" size={16} color={colors.text} /><Text style={styles.secondaryText}>{t("MESSAGE")}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("More")} testID="profile-menu" onPress={() => setMenuOpen(open => !open)} style={styles.secondary}><Ionicons name="ellipsis-horizontal" size={16} color={colors.text} /></Pressable>
        </View> : null}
        {!own && menuOpen ? <View style={styles.menu} testID="profile-menu-sheet">
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
        </View> : null}
        {!own && profile.is_private && !profile.can_view_posts ? <View style={styles.locked} testID="private-account-notice">
          <Ionicons name="lock-closed-outline" size={28} color={colors.textDim} />
          <Text style={styles.hint}>{t("This account is private. Follow to see their posts.")}</Text>
        </View> : null}
        {!own && !profile.can_message ? <Text style={styles.hint}>{t("Messaging unlocks when you follow each other, share a community, or have a coaching relationship.")}</Text> : null}
        {canSeePosts ? <View style={styles.wall} testID="profile-posts">
          {own ? <Composer onPublished={created => { posts.prepend(created); setProfile(current => current ? { ...current, posts: current.posts + 1 } : current); }} /> : null}
          {!posts.loading && posts.posts.length === 0 ? <Text style={styles.hint}>{t("No posts yet.")}</Text> : null}
          {posts.posts.map(post => <PostCard key={post.id} post={post} onChange={next => posts.patch(post.id, () => next)} onRemoved={() => posts.remove(post.id)} onReposted={() => undefined} />)}
          {posts.hasMore ? <Pressable accessibilityRole="button" onPress={() => void posts.loadMore()} style={styles.icon}><Text style={styles.retry}>{t("LOAD MORE")}</Text></Pressable> : null}
        </View> : null}
      </> : null}
    </ScrollView>
    <ReportSheet target={reporting} onClose={() => setReporting(null)} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, scroll: { padding: spacing.lg, alignItems: "center", gap: spacing.md, paddingBottom: spacing.xxxl }, avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: colors.brand, alignItems: "center", justifyContent: "center" }, coachTag: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill }, coachText: { color: colors.brandOn, fontSize: 10, fontWeight: "900", letterSpacing: 1 }, bio: { color: colors.text, textAlign: "center", maxWidth: 420, lineHeight: 20 }, wall: { alignSelf: "stretch", borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.lg }, name: { ...type.screenTitle, fontSize: 24 }, stats: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.sm }, stat: { alignItems: "center" }, statValue: { color: colors.text, fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"] }, statLabel: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1 }, actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }, primary: { minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }, primaryText: { ...type.button, fontSize: 12 }, secondary: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: "transparent" }, secondaryText: { color: colors.text, fontSize: 12, fontWeight: "900", letterSpacing: 1 }, disabled: { opacity: 0.4 }, hint: { color: colors.textMuted, fontSize: 12, textAlign: "center", maxWidth: 360, lineHeight: 18 }, error: { color: colors.error }, retry: { color: colors.brand, fontWeight: "900" }, privateTag: { flexDirection: "row", alignItems: "center", gap: 4 }, privateText: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1 }, menu: { alignSelf: "stretch", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, padding: spacing.sm, gap: 2 }, menuRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm }, menuText: { color: colors.text, fontSize: 13, fontWeight: "700" }, menuHint: { color: colors.textDim, fontSize: 11, paddingHorizontal: spacing.sm, paddingBottom: 4, lineHeight: 15 }, locked: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl } });
