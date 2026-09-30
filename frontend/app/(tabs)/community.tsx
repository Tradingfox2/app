import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { api, COMMUNITY_CATEGORIES, type CommunityCategory, Community, User } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { Composer, PostCard, useFeed } from "@/src/components/social/feed";
import { StoriesTray } from "@/src/components/social/stories-tray";
import { Avatar } from "@/src/components/social/avatar";
import { LISTED_PUBLICLY_LABEL, joinPolicyPhrase, selectedControl } from "@/src/community-copy";
import { LiveNowStrip } from "@/src/components/live-now-strip";

const DISCOVER_PAGE = 50;

type Tab = "feed" | "discover" | "mine" | "coaches" | "rankings";
type Coach = User & { community_count: number; member_count: number };

export default function CommunityScreen() {
  const { user } = useAuth();
  const { t, formatNumber, localeTag } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("feed");
  const feed = useFeed();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [mine, setMine] = useState<Community[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [rankings, setRankings] = useState<Awaited<ReturnType<typeof api.communityRankings>> | null>(null);
  const [category, setCategory] = useState<CommunityCategory | null>(null);
  const [moreCommunities, setMoreCommunities] = useState(false);
  const [trending, setTrending] = useState<{ tag: string; posts: number }[]>([]);
  const [archived, setArchived] = useState<Community[]>([]);
  const [dmUnread, setDmUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);

  const load = useCallback(async () => {
    const requestRevision = ++revision.current;
    setError("");
    try {
      const [discoverResult, mineResult, coachResult, rankingResult] = await Promise.all([
        api.communities("discover", { category, sort: "trending" }), api.communities("mine"), api.coaches(), api.communityRankings(),
      ]);
      if (requestRevision !== revision.current) return;
      setCommunities(discoverResult);
      setMoreCommunities(discoverResult.length === DISCOVER_PAGE);
      // Extras: none of these may take the tab down if they fail.
      api.trendingTags().then(rows => { if (requestRevision === revision.current) setTrending(rows); }).catch(() => undefined);
      api.archivedCommunities().then(rows => { if (requestRevision === revision.current) setArchived(rows); }).catch(() => undefined);
      api.dmUnreadCount().then(row => { if (requestRevision === revision.current) setDmUnread(row.count); }).catch(() => undefined);
      setMine(mineResult);
      setCoaches(coachResult);
      setRankings(rankingResult);
    } catch {
      if (requestRevision === revision.current) setError(t("Something went wrong"));
    } finally {
      if (requestRevision === revision.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [t, category]);

  const loadMoreCommunities = async () => {
    try {
      const rows = await api.communities("discover", { category, offset: communities.length, sort: "trending" });
      setCommunities(current => [...current, ...rows.filter(row => !current.some(existing => existing.id === row.id))]);
      setMoreCommunities(rows.length === DISCOVER_PAGE);
    } catch { setError(t("Something went wrong")); }
  };
  const restore = async (community: Community) => {
    try { await api.restoreCommunity(community.id); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
  };

  useFocusEffect(useCallback(() => {
    void load();
    void feed.load();
    return () => { revision.current += 1; feed.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feed helpers are stable per mount
  }, [load]));

  const openCommunity = (community: Pick<Community, "id">) => router.push({ pathname: "/community/[id]", params: { id: community.id } });
  const isCoach = user?.role === "coach";
  const hasClub = mine.some(row => row.membership?.status === "active");
  const clubFirst = !isCoach && !loading && !hasClub;

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="community-screen">
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); void feed.load(); }} tintColor={colors.text} />}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{t("TRAIN TOGETHER")}</Text>
            <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{t("COMMUNITY")}</Text>
          </View>
          <Pressable accessibilityLabel={t("Messages")} testID="open-messages" style={styles.headerAction} onPress={() => router.push("/messages")}>
            <HeaderMark name="messages" />
            {dmUnread ? <View style={styles.headerBadge} testID="dm-unread-badge"><Text style={styles.headerBadgeText}>{dmUnread > 99 ? "99+" : dmUnread}</Text></View> : null}
          </Pressable>
          <Pressable accessibilityLabel={t("Saved posts")} testID="open-saved" style={styles.headerAction} onPress={() => router.push("/saved")}>
            <HeaderMark name="saved" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Search")} testID="open-search" style={styles.headerAction} onPress={() => router.push("/search")}>
            <HeaderMark name="search" />
          </Pressable>
          <Pressable accessibilityLabel={t(isCoach ? "Open partner dashboard" : "Become a coach")} style={styles.headerAction} onPress={() => isCoach ? router.push("/partner" as Href) : router.push("/coach/onboarding")}>
            <HeaderMark name={isCoach ? "dashboard" : "coach"} />
          </Pressable>
        </View>

        <View style={styles.signalBand}>
          <View style={styles.signalCopy}>
            <Text style={styles.signalTitle}>{t("Find your people. Build momentum.")}</Text>
            <Text style={styles.signalBody}>{t("Join focused training groups, learn from coaches, and keep the conversation moving between sessions.")}</Text>
          </View>
          <View style={styles.signalActions}>
            {isCoach ? <Pressable style={styles.primaryAction} testID="community-primary-cta" onPress={() => router.push("/community/new")}>
              <Ionicons name="add" size={17} color={colors.brandOn} />
              <Text style={styles.primaryActionText}>{t("CREATE")}</Text>
            </Pressable> : clubFirst ? <>
              <Pressable style={styles.primaryAction} testID="community-primary-cta" onPress={() => setTab("discover")}>
                <Ionicons name="search" size={17} color={colors.brandOn} />
                <Text style={styles.primaryActionText}>{t("FIND A CLUB")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} testID="community-start-club" onPress={() => router.push("/coach/onboarding")}>
                <Text style={styles.secondaryActionText}>{t("START A CLUB")}</Text>
              </Pressable>
            </> : !loading ? <Pressable style={styles.primaryAction} testID="community-primary-cta" onPress={() => router.push("/coach/onboarding")}>
              <Ionicons name="arrow-forward" size={17} color={colors.brandOn} />
              <Text style={styles.primaryActionText}>{t("BECOME A COACH")}</Text>
            </Pressable> : null}
          </View>
        </View>

        <LiveNowStrip inset />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {(["feed", "discover", "mine", "coaches", "rankings"] as Tab[]).map((item) => (
            <Pressable key={item} accessibilityRole="tab" {...selectedControl(tab === item)} accessibilityLabel={t(item.toUpperCase())} testID={`community-tab-${item}`} style={[styles.tab, tab === item && styles.tabActive]} onPress={() => setTab(item)}>
              <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{t(item.toUpperCase())}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {tab === "feed" ? (
          <View testID="feed">
            <StoriesTray />
            <View style={styles.scopeRow}>
              {(["all", "friends", "mine"] as const).map(scope => (
                <Pressable key={scope} accessibilityRole="button" {...selectedControl(feed.scope === scope)} testID={`feed-scope-${scope}`} onPress={() => feed.changeScope(scope)} style={[styles.scopeChip, feed.scope === scope && styles.scopeChipActive]}>
                  <Text style={[styles.scopeText, feed.scope === scope && styles.scopeTextActive]}>{t(scope === "all" ? "EVERYONE" : scope === "friends" ? "Friends" : "MY POSTS")}</Text>
                </Pressable>
              ))}
            </View>
            <Composer onPublished={feed.prepend} />
            {trending.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeRow} testID="trending-tags">
              <Ionicons name="trending-up" size={16} color={colors.text} style={{ alignSelf: "center" }} />
              {trending.map(row => <Pressable key={row.tag} accessibilityRole="button" testID={`trending-${row.tag}`} onPress={() => router.push({ pathname: "/tag/[tag]", params: { tag: row.tag } })} style={styles.scopeChip}>
                <Text style={styles.scopeText}>#{row.tag} · {formatNumber(row.posts)}</Text>
              </Pressable>)}
            </ScrollView> : null}
            {feed.loading ? <ActivityIndicator color={colors.text} style={styles.loader} /> : null}
            {feed.error ? <View accessibilityRole="alert" style={styles.list}><Text style={styles.emptyText}>{feed.error}</Text><Pressable accessibilityRole="button" onPress={() => void feed.load()} style={styles.primaryAction}><Text style={styles.primaryActionText}>{t("Retry")}</Text></Pressable></View> : null}
            {!feed.loading && !feed.error && feed.posts.length === 0 ? <Empty icon="newspaper-outline" text={t(feed.scope === "friends" ? "Follow athletes and coaches to build your feed" : "No posts yet. Share your first session.")} /> : null}
            {feed.posts.map(post => <PostCard key={post.id} post={post} onChange={next => feed.patch(post.id, () => next)} onRemoved={() => feed.remove(post.id)} onReposted={feed.prepend} />)}
            {feed.hasMore ? <Pressable accessibilityRole="button" testID="feed-load-more" disabled={feed.loadingMore} onPress={() => void feed.loadMore()} style={[styles.loadMore, feed.loadingMore && { opacity: 0.5 }]}>
              {feed.loadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.loadMoreText}>{t("LOAD MORE")}</Text>}
            </Pressable> : null}
          </View>
        ) : null}

        {loading ? <ActivityIndicator color={colors.text} style={styles.loader} /> : null}
        {error ? <View accessibilityRole="alert" style={styles.list}>
          <Text style={styles.emptyText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.primaryAction}>
            <Text style={styles.primaryActionText}>{t("Retry")}</Text>
          </Pressable>
        </View> : null}

        {!loading && !error && (tab === "discover" || tab === "mine") ? (
          <View style={styles.list}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t(tab === "discover" ? "TRENDING COMMUNITIES" : "YOUR COMMUNITIES")}</Text>
              <Text style={styles.count}>{formatNumber((tab === "discover" ? communities : mine).length)}</Text>
            </View>
            {tab === "discover" ? <Text style={styles.rankingNote}>{t("New members in the last 14 days.")}</Text> : null}
            {tab === "discover" ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.sm, paddingHorizontal: spacing.lg }} testID="category-filter">
              {([null, ...COMMUNITY_CATEGORIES] as (CommunityCategory | null)[]).map(item => <Pressable key={item ?? "all"} accessibilityRole="button" {...selectedControl(category === item)} testID={`category-${item ?? "all"}`} onPress={() => { setCategory(item); setLoading(true); }} style={[styles.scopeChip, category === item && styles.scopeChipActive]}>
                <Text style={[styles.scopeText, category === item && styles.scopeTextActive]}>{t(item ? item.replace("_", " ").toUpperCase() : "ALL")}</Text>
              </Pressable>)}
            </ScrollView> : null}
            {(tab === "discover" ? communities : mine).map((community) => (
              <Pressable key={community.id} testID={`community-${community.id}`} style={styles.communityRow} onPress={() => openCommunity(community)}>
                <View style={styles.communityCopy}>
                  <View style={styles.nameLine}>
                    <Text numberOfLines={1} style={styles.communityName}>{community.name}</Text>
                    {!community.is_public ? <Ionicons name="lock-closed" size={12} color={colors.textMuted} /> : null}
                  </View>
                  <Text numberOfLines={2} style={styles.communityDescription}>{community.description || t("A focused place to train and progress together.")}</Text>
                  <View style={styles.metaLine}>
                    <Text style={styles.meta}>{formatNumber(community.member_count)} {t("members")}</Text>
                    <Text style={styles.dot}>•</Text>
                    <Text style={styles.meta}>{community.join_policy === "paid" ? new Intl.NumberFormat(localeTag, { style: "currency", currency: community.currency }).format(community.price_cents / 100) : t(joinPolicyPhrase(community.join_policy))}</Text>
                    {community.is_public ? <><Text style={styles.dot}>•</Text><Text style={styles.meta}>{t(LISTED_PUBLICLY_LABEL)}</Text></> : null}
                    {community.membership ? <View style={styles.memberBadge}><Text style={styles.memberBadgeText}>{t(community.membership.status.toUpperCase())}</Text></View> : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </Pressable>
            ))}
            {(tab === "discover" ? communities : mine).length === 0 ? <Empty icon="people-outline" text={t(tab === "discover" ? "No communities yet" : "You have not joined a community yet")} /> : null}
            {tab === "discover" && moreCommunities ? <Pressable accessibilityRole="button" testID="communities-more" onPress={() => void loadMoreCommunities()} style={styles.loadMore}><Text style={styles.loadMoreText}>{t("LOAD MORE")}</Text></Pressable> : null}
            {tab === "mine" && archived.length ? <>
              <View style={[styles.sectionHead, { marginTop: spacing.xl }]}><Text style={styles.sectionTitle}>{t("ARCHIVED BY YOU")}</Text></View>
              {archived.map(row => <View key={row.id} style={styles.rankingRow} testID={`archived-${row.id}`}>
                <Text numberOfLines={1} style={styles.rankingName}>{row.name}</Text>
                <Pressable accessibilityRole="button" testID={`restore-${row.id}`} onPress={() => void restore(row)} style={styles.scopeChip}><Text style={styles.scopeText}>{t("RESTORE")}</Text></Pressable>
              </View>)}
            </> : null}
          </View>
        ) : null}

        {!loading && !error && tab === "coaches" ? (
          <View style={styles.list}>
            <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{t("TOP COACHES")}</Text><Text style={styles.count}>{formatNumber(coaches.length)}</Text></View>
            <Text style={styles.rankingNote} testID="coaches-basis">{t("Athletes in active public clubs. The coach is not counted.")}</Text>
            {coaches.map((coach) => (
              <Pressable key={coach.id} accessibilityRole="button" testID={`coach-${coach.id}`} onPress={() => router.push({ pathname: "/user/[id]", params: { id: coach.id } })} style={styles.coachRow}>
                <Avatar user={coach} size={44} />
                <View style={styles.communityCopy}>
                  <Text style={styles.communityName}>{coach.full_name || t("Coach")}</Text>
                  <Text style={styles.meta}>{formatNumber(coach.member_count)} {t("members")} · {formatNumber(coach.community_count)} {t("communities")}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={19} color={colors.text} />
              </Pressable>
            ))}
            {coaches.length === 0 ? <Empty icon="ribbon-outline" text={t("No approved coaches yet")} /> : null}
          </View>
        ) : null}

        {!loading && !error && tab === "rankings" ? (
          <View style={styles.list}>
            <Text style={styles.rankingNote}>{t("Communities and coaches: active memberships. Activity: last 30 days, opt-in only.")}</Text>
            <Text style={styles.sectionTitle}>{t("TOP COMMUNITIES")}</Text>
            {(rankings?.communities || []).map((community, index) => (
              <Pressable key={community.id} style={styles.rankingRow} onPress={() => openCommunity(community)}>
                <Text style={styles.rankingNumber}>{index + 1}</Text><Text numberOfLines={1} style={styles.rankingName}>{community.name}</Text><Text style={styles.rankingValue}>{formatNumber(community.member_count)}</Text>
              </Pressable>
            ))}
            <Text style={[styles.sectionTitle, styles.coachRankingTitle]}>{t("TOP COACHES")}</Text>
            {(rankings?.coaches || []).map((row, index) => {
              const personId = row.coach?.id;
              return (
                <Pressable key={personId || `coach-${index}`} accessibilityRole="button" accessibilityState={{ disabled: !personId }} accessibilityLabel={personId ? row.coach?.full_name || t("Coach") : t("Coach profile unavailable")} disabled={!personId} testID={personId ? `ranking-coach-${personId}` : `ranking-coach-missing-${index}`} onPress={() => { if (personId) router.push({ pathname: "/user/[id]", params: { id: personId } }); }} style={[styles.rankingRow, !personId && styles.rankingDisabled]}>
                  <Text style={styles.rankingNumber}>{index + 1}</Text><Text numberOfLines={1} style={styles.rankingName}>{row.coach?.full_name || t("Coach")}</Text><Text style={styles.rankingValue}>{formatNumber(row.member_count)}</Text>
                </Pressable>
              );
            })}
            <Text style={[styles.sectionTitle, styles.coachRankingTitle]}>{t("TOP USERS")}</Text>
            <Text style={styles.rankingNote}>{t("Ranked by active days, not message volume.")}</Text>
            {(rankings?.users || []).map((row, index) => {
              const personId = row.id;
              return (
                <Pressable key={personId || `user-${index}`} accessibilityRole="button" accessibilityState={{ disabled: !personId }} accessibilityLabel={personId ? row.full_name || t("Member") : t("Member profile unavailable")} disabled={!personId} testID={personId ? `ranking-user-${personId}` : `ranking-user-missing-${index}`} onPress={() => { if (personId) router.push({ pathname: "/user/[id]", params: { id: personId } }); }} style={[styles.rankingRow, !personId && styles.rankingDisabled]}>
                  <Text style={styles.rankingNumber}>{index + 1}</Text>
                  <Text numberOfLines={1} style={styles.rankingName}>{row.full_name || t("Member")}</Text>
                  <Text style={styles.rankingValue}>{t("{count} active days", { count: formatNumber(row.active_days) })}</Text>
                </Pressable>
              );
            })}
            {!rankings?.users?.length ? <Text style={styles.rankingNote}>{t("No opted-in activity yet")}</Text> : null}
            <Text style={[styles.sectionTitle, styles.coachRankingTitle]}>{t("TOP CHANNELS")}</Text>
            {(rankings?.channels || []).map((row, index) => {
              const allowed = !!row.id && mine.some(community => community.id === row.community_id);
              return (
                <Pressable key={row.id || `channel-${index}`} accessibilityRole="button" accessibilityState={{ disabled: !allowed }} accessibilityLabel={t("Open channel {name}", { name: row.name })} disabled={!allowed} testID={row.id ? `ranking-channel-${row.id}` : `ranking-channel-missing-${index}`} onPress={() => { if (allowed) router.push({ pathname: "/channel/[id]", params: { id: row.id } }); }} style={[styles.rankingRow, !allowed && styles.rankingDisabled]}>
                  <Text style={styles.rankingNumber}>{index + 1}</Text>
                  <View style={styles.communityCopy}><Text style={styles.communityName}># {row.name}</Text><Text style={styles.meta}>{row.community_name}</Text></View>
                  <Text style={styles.rankingValue}>{t("{count} contributors", { count: formatNumber(row.contributors) })}</Text>
                </Pressable>
              );
            })}
            {!rankings?.channels?.length ? <Text style={styles.rankingNote}>{t("No opted-in activity yet")}</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function HeaderMark({ name }: { name: "messages" | "saved" | "search" | "coach" | "dashboard" }) {
  const color = colors.text;
  const frame = { width: 26, height: 26, viewBox: "0 0 24 24" };
  if (name === "messages") {
    return (
      <Svg {...frame}>
        <Path
          d="M6 5.2h9.4c1.8 0 3.2 1.4 3.2 3.2v5c0 1.8-1.4 3.2-3.2 3.2h-4.1L8.1 20.4c-.4.3-1-.1-1-.6v-3.2H6c-1.8 0-3.2-1.4-3.2-3.2v-5C2.8 6.6 4.2 5.2 6 5.2Z"
          fill={color}
        />
        <Circle cx="8.2" cy="10.8" r="1.05" fill={colors.bg} />
        <Circle cx="11.6" cy="10.8" r="1.05" fill={colors.bg} />
        <Circle cx="15" cy="10.8" r="1.05" fill={colors.bg} />
      </Svg>
    );
  }
  if (name === "saved") {
    return (
      <Svg {...frame}>
        <Path
          d="M6.2 3.6h11.6c.8 0 1.4.6 1.4 1.4v15.6L12 17.1 4.8 20.6V5c0-.8.6-1.4 1.4-1.4Z"
          fill={color}
        />
      </Svg>
    );
  }
  if (name === "search") {
    return (
      <Svg {...frame}>
        <Circle cx="10.4" cy="10.4" r="5.3" stroke={color} strokeWidth={2.6} fill="none" />
        <Path d="M14.5 14.5 20 20" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
      </Svg>
    );
  }
  if (name === "dashboard") {
    return (
      <Svg {...frame}>
        <Rect x="3.5" y="13" width="4.2" height="7" rx="1.1" fill={color} />
        <Rect x="9.9" y="8" width="4.2" height="12" rx="1.1" fill={color} />
        <Rect x="16.3" y="4" width="4.2" height="16" rx="1.1" fill={color} />
      </Svg>
    );
  }
  return (
    <Svg {...frame}>
      <Circle cx="9" cy="8.2" r="3.4" fill={color} />
      <Path d="M3.4 20.2v-.5c0-3.2 2.5-5.4 5.6-5.4s5.6 2.2 5.6 5.4v.5H3.4Z" fill={color} />
      <Path d="m16.2 2.4 1.15 2.7 2.9.25-2.2 1.9.7 2.85-2.55-1.55-2.55 1.55.7-2.85-2.2-1.9 2.9-.25 1.15-2.7Z" fill={color} />
    </Svg>
  );
}

function Empty({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.empty}><Ionicons name={icon} size={36} color={colors.textDim} /><Text style={styles.emptyText}>{text}</Text></View>;
}

const styles = StyleSheet.create({ loadMore: { minHeight: 48, marginVertical: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" }, loadMoreText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  safe: { flex: 1, backgroundColor: colors.bg }, scroll: { paddingBottom: 120 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, flexDirection: "row", alignItems: "center" },
  headerCopy: { flex: 1 }, eyebrow: { ...type.eyebrow, color: colors.text }, title: { ...type.screenTitle, marginTop: 2 },
  headerAction: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", marginLeft: spacing.xs },
  headerBadge: { position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.text, alignItems: "center", justifyContent: "center" },
  headerBadgeText: { color: colors.bg, fontSize: 10, fontWeight: "700" },
  scopeRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  scopeChip: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: "center" }, scopeChipActive: { borderColor: colors.border, backgroundColor: colors.surface2 },
  scopeText: { color: colors.textMuted, fontSize: 13, fontWeight: "400" }, scopeTextActive: { color: colors.text, fontWeight: "600" },
  signalBand: { padding: spacing.lg, backgroundColor: colors.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, gap: spacing.lg },
  signalActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  secondaryAction: { minHeight: 44, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong },
  secondaryActionText: { color: colors.text, fontSize: 12, fontWeight: "900", letterSpacing: 0.6 },
  signalCopy: { maxWidth: 640 }, signalTitle: { color: colors.text, fontSize: 21, lineHeight: 25, fontWeight: "900" },
  signalBody: { color: colors.textMuted, lineHeight: 20, marginTop: spacing.sm, maxWidth: 560 },
  primaryAction: { minHeight: 44, alignSelf: "flex-start", paddingHorizontal: spacing.md, flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.brand, borderRadius: radius.sm },
  primaryActionText: { ...type.button, fontSize: 12 }, tabs: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  tab: { minHeight: 38, justifyContent: "center", paddingHorizontal: spacing.md, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.text }, tabText: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 1 }, tabTextActive: { color: colors.text },
  loader: { marginTop: spacing.xxl }, list: { paddingTop: spacing.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm, paddingHorizontal: spacing.lg }, sectionTitle: { ...type.section, flex: 1 },
  count: { color: colors.textDim, fontSize: 12, fontVariant: ["tabular-nums"] },
  communityRow: { minHeight: 112, flexDirection: "row", alignItems: "center", padding: spacing.lg, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.md },
  communityCopy: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 }, communityName: { color: colors.text, fontSize: 16, fontWeight: "800", flexShrink: 1 },
  communityDescription: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 4 }, metaLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: spacing.sm },
  meta: { color: colors.textMuted, fontSize: 11, fontWeight: "700" }, dot: { color: colors.textDim },   memberBadge: { backgroundColor: colors.surface2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  memberBadgeText: { color: colors.text, fontSize: 11, fontWeight: "600" }, coachRow: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.text, fontWeight: "900" },
  rankingNote: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: spacing.xl, paddingHorizontal: spacing.lg }, rankingRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }, rankingDisabled: { opacity: 0.4 },
  rankingNumber: { color: colors.text, width: 24, fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] }, rankingName: { color: colors.text, fontWeight: "600", flex: 1 }, rankingValue: { color: colors.textMuted, fontWeight: "700", fontVariant: ["tabular-nums"] },
  coachRankingTitle: { marginTop: spacing.xxl }, empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }, emptyText: { color: colors.textMuted, textAlign: "center" },
});
