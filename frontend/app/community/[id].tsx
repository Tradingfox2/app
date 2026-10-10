import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { api, mediaUrl, type ChannelKind, type Community, type CommunityChannel, type MentionedUser } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { LISTED_PUBLICLY_LABEL, joinPolicyPhrase, selectedControl } from "@/src/community-copy";
import { MANAGE_CHANNEL, can } from "@/src/permissions";
import { Avatar } from "@/src/components/social/avatar";
import { Composer, PostCard, useFeed } from "@/src/components/social/feed";
import { ReportSheet, type ReportTarget } from "@/src/components/social/report-sheet";
import { ChallengePanel } from "@/src/components/community/fitness-panel";
import { copyLink, shareLink } from "@/src/share";
import { openCheckout, waitForMembership } from "@/src/checkout";

type Tab = "channels" | "wall" | "about" | "members";

const KIND_ICONS: Record<ChannelKind, keyof typeof Ionicons.glyphMap> = {
  text: "chatbubbles-outline", announcement: "megaphone-outline", program: "barbell-outline",
  challenge: "trophy-outline", checkin: "flame-outline", live: "radio-outline",
};

export default function CommunityDetail() {
  const { id, checkout } = useLocalSearchParams<{ id: string; checkout?: string }>(); const router = useRouter(); const { t, formatNumber, localeTag, formatDate } = useI18n();
  const [community, setCommunity] = useState<Community | null>(null); const [channels, setChannels] = useState<CommunityChannel[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [tab, setTab] = useState<Tab>("channels");
  const [members, setMembers] = useState<MentionedUser[] | null>(null);
  const [membersError, setMembersError] = useState("");
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const wall = useFeed({ community_id: id });
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const value = await api.community(id); setCommunity(value);
      if (value.membership?.status === "active") {
        setChannels(await api.communityChannels(id));
        // First visit after joining: the welcome and the rules, once.
        const hasIntro = !!value.welcome_message?.trim() || !!value.rules?.length;
        if (hasIntro && !value.membership.onboarded_at && value.membership.role !== "owner") setOnboarding(true);
      } else setChannels([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load community")); }
  }, [id, t]);
  useEffect(() => void load(), [load]);
  const isActive = community?.membership?.status === "active";
  useEffect(() => {
    if (tab === "wall" && isActive) void wall.load();
    if (tab === "members" && isActive && members === null && !membersError && id) {
      api.memberDirectory(id).then(rows => { setMembers(rows); setMembersError(""); }).catch(cause => {
        setMembersError(cause instanceof Error ? cause.message : t("Could not load members"));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feed helpers are stable per community
  }, [tab, isActive, id, members, membersError, t]);
  const [confirming, setConfirming] = useState(false);
  // Back from Stripe: the server, not the return URL, says whether it worked.
  const confirmPayment = useCallback(async () => {
    if (!id) return;
    setConfirming(true); setError("");
    const active = await waitForMembership(id);
    await load();
    setConfirming(false);
    if (!active) setError(t("No payment confirmed yet. If you completed checkout, your membership will appear here within a few minutes."));
  }, [id, load, t]);
  // Stripe's redirect opens this page cold, before the router can take a
  // setParams — so remember the handled value instead of clearing the URL.
  const handledCheckout = useRef<string | null>(null);
  useEffect(() => {
    if (!checkout || handledCheckout.current === checkout) return;
    handledCheckout.current = checkout;
    if (checkout === "cancelled") setError(t("Checkout cancelled. No payment was taken."));
    else void confirmPayment();
  }, [checkout, confirmPayment, t]);
  const join = async () => {
    if (!id || busy) return;
    setBusy(true); setError("");
    try {
      if (community?.join_policy === "paid") { if (await openCheckout(id) === "closed") await confirmPayment(); }
      else { await api.joinCommunity(id); await load(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not join community")); }
    finally { setBusy(false); }
  };
  // An owner leaving would orphan the community; they archive or transfer it instead.
  const leave = async () => {
    if (!id || busy) return;
    setBusy(true); setError("");
    try { await api.leaveCommunity(id); router.replace("/community"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not leave the community")); }
    finally { setBusy(false); }
  };
  // A plain invite grants only what joining would; approval still applies.
  const createInvite = async () => {
    if (!id || inviting) return;
    setInviting(true); setInviteError("");
    try {
      const invite = await api.createInvite(id, {});
      setInviteLink(Linking.createURL(`/invite/${invite.code}`));
    } catch (cause) { setInviteError(cause instanceof Error ? cause.message : t("Could not create invite")); }
    finally { setInviting(false); }
  };
  const shareInvite = async () => {
    if (!inviteLink) return;
    setInviteError("");
    const result = await shareLink(inviteLink);
    if (result === "shared" || result === "dismissed") return;
    const copied = await copyLink(inviteLink);
    setInviteError(copied
      ? t("Sharing is unavailable on this device. The link was copied instead.")
      : t("Could not share this invite."));
  };
  const finishOnboarding = async () => {
    setOnboarding(false);
    if (id) api.completeOnboarding(id).catch(() => undefined);
  };
  if (!community && !error) return <SafeAreaView style={styles.safe}><ActivityIndicator color={colors.text} style={{ marginTop: spacing.xxxl }} /></SafeAreaView>;

  const membership = community?.membership;
  const isManager = membership?.role === "owner" || membership?.role === "moderator" || channels.some(channel => can(channel.permissions, MANAGE_CHANNEL));
  const timedOutUntil = membership?.timeout_until && new Date(membership.timeout_until).getTime() > Date.now() ? membership.timeout_until : null;
  // Channels grouped under their manager-set headings, ungrouped ones first.
  const openChallenges = channels.filter(channel => {
    if (channel.kind !== "challenge") return false;
    const ends = channel.challenge?.ends_at;
    return !ends || new Date(ends).getTime() > Date.now();
  });
  const groups: [string, CommunityChannel[]][] = [];
  for (const channel of channels) {
    const heading = channel.category || "";
    const group = groups.find(([name]) => name === heading);
    if (group) group[1].push(channel); else groups.push([heading, [channel]]);
  }

  return <SafeAreaView style={styles.safe}><View style={styles.header}><Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance><Text numberOfLines={1} style={styles.headerTitle}>{community?.name || t("COMMUNITY")}</Text>
    {isActive ? <Affordance accessibilityRole="button" accessibilityLabel={t("Invite people")} testID="invite-people" disabled={inviting} onPress={() => void createInvite()} style={styles.icon}><Ionicons name="person-add-outline" size={20} color={colors.text} /></Affordance> : null}
    {isManager ? <Affordance accessibilityRole="button" accessibilityLabel={t("Manage community")} testID="manage-community" onPress={() => router.push({ pathname: "/community/[id]/manage", params: { id } })} style={styles.icon}><Ionicons name="settings-outline" size={20} color={colors.text} /></Affordance> : null}
    {community && membership?.role !== "owner" ? <Affordance accessibilityRole="button" accessibilityLabel={t("Report community")} testID="report-community" onPress={() => setReporting({ target_type: "community", target_id: community.id })} style={styles.icon}><Ionicons name="flag-outline" size={18} color={colors.textDim} /></Affordance> : null}
  </View>
    {inviteLink ? <View style={styles.invitePanel} testID="invite-panel">
      <Text style={styles.inviteTitle}>{t("INVITE LINK")}</Text>
      <Text selectable style={styles.inviteLink} testID="invite-link">{inviteLink}</Text>
      <Text style={styles.inviteHint}>{t("Valid for 7 days. Anyone with the link can ask to join.")}</Text>
      <View style={styles.inviteRow}>
        <Affordance accessibilityRole="button" testID="invite-close" onPress={() => setInviteLink("")} style={styles.inviteSecondary}><Text style={styles.inviteSecondaryText}>{t("DONE")}</Text></Affordance>
        <Affordance signal="brand" accessibilityRole="button" testID="invite-share" onPress={() => void shareInvite()} style={styles.invitePrimary}><Text style={styles.invitePrimaryText}>{t("SHARE")}</Text></Affordance>
      </View>
    </View> : null}
    {inviteError ? <View accessibilityRole="alert" accessibilityLabel={inviteError} testID="invite-error" style={styles.notice}><Ionicons name="information-circle" size={18} color={colors.warning} aria-hidden accessibilityElementsHidden importantForAccessibility="no" /><Text style={styles.noticeText}>{inviteError}</Text></View> : null}
    {community ? <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.hero}>
        {community.cover_url ? <Image source={{ uri: mediaUrl(community.cover_url) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
        {community.cover_url ? <View style={styles.heroShade} /> : null}
        <View style={styles.heroTop}>
          {community.avatar_url ? <Image source={{ uri: mediaUrl(community.avatar_url) }} style={styles.communityAvatar} accessibilityIgnoresInvertColors /> : null}
          <Text style={styles.kicker}>{community.join_policy === "open" ? t(joinPolicyPhrase("open")) : community.join_policy === "approval" ? t("APPLICATION REQUIRED") : t("PAID MEMBERSHIP")}{community.category && community.category !== "general" ? ` · ${t(community.category.replace("_", " ").toUpperCase())}` : ""}</Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>{community.name}</Text>
        {community.redacted ? null : <Text style={styles.description} numberOfLines={3}>{community.description || t("A focused place to train and progress together.")}</Text>}
        <View style={styles.meta}><Ionicons name="people" size={16} color={colors.text} /><Text style={styles.metaText}>{formatNumber(community.member_count)} {t("members")}</Text><Text style={styles.metaText}>· {community.owner?.full_name || t("Coach")}</Text>{community.is_public ? <Text style={styles.metaText}>· {t(LISTED_PUBLICLY_LABEL)}</Text> : null}</View>
      </View>
      {!isActive ? <View style={styles.joinBand}><View style={{ flex: 1 }}><Text style={styles.joinTitle}>{confirming ? t("CONFIRMING PAYMENT…") : membership?.status === "pending" ? t("REQUEST PENDING") : membership?.status === "banned" ? t("YOU ARE BANNED") : membership?.status === "rejected" ? t("REQUEST DECLINED") : community.join_policy === "paid" ? new Intl.NumberFormat(localeTag, { style: "currency", currency: community.currency }).format(community.price_cents / 100) + t(" / month") : t("JOIN THE GROUP")}</Text><Text style={styles.joinCopy}>{membership?.status === "pending" ? t("A community manager will review your request.") : membership?.status === "banned" ? t("The community's managers removed you.") : membership?.status === "rejected" ? t("A manager declined this request.") : !community.is_public ? t("This community is invite-only. Ask a member for a link.") : community.join_policy === "paid" ? t("Monthly, by card through Stripe. Leave any time and the subscription stops.") : t("Get access to channels and member conversations.")}</Text></View>{confirming ? <ActivityIndicator color={colors.text} testID="checkout-confirming" /> : membership?.status !== "pending" && membership?.status !== "banned" && community.is_public ? <Affordance signal="brand" onPress={join} disabled={busy} style={styles.joinButton} testID="join-community"><Text style={styles.joinButtonText}>{t(community.join_policy === "paid" ? "CONTINUE" : community.join_policy === "approval" ? "REQUEST" : "JOIN")}</Text></Affordance> : null}</View> : null}
      {timedOutUntil ? <View style={styles.notice} testID="timeout-notice"><Ionicons name="time-outline" size={18} color={colors.warning} /><Text style={styles.noticeText}>{t("You are timed out until {date}. You can read but not post.").replace("{date}", formatDate(timedOutUntil, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</Text></View> : null}
      {error ? <View style={styles.notice}><Ionicons name="information-circle" size={18} color={colors.warning} /><Text style={styles.noticeText}>{error}</Text></View> : null}
      {isActive ? <View style={styles.tabs}>{(["channels", "wall", "about", "members"] as Tab[]).map(item => <Affordance key={item} accessibilityRole="tab" {...selectedControl(tab === item)} accessibilityLabel={t(item.toUpperCase())} testID={`community-detail-tab-${item}`} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabOn]}><Text style={[styles.tabText, tab === item && styles.tabTextOn]}>{t(item.toUpperCase())}</Text></Affordance>)}</View> : null}

      {isActive && tab === "channels" ? <>
        {openChallenges.length ? <View testID="club-challenges">
          <View style={styles.sectionHead}><Text style={styles.section}>{t("CHALLENGES")}</Text><Text style={styles.count}>{openChallenges.length}</Text></View>
          {openChallenges.map(channel => <View key={channel.id} testID={`club-challenge-${channel.id}`}>
            <ChallengePanel channelId={channel.id} refreshKey={0} />
            <Affordance accessibilityRole="button" testID={`open-challenge-${channel.id}`} onPress={() => router.push({ pathname: "/channel/[id]", params: { id: channel.id } })} style={styles.channel}><Text style={styles.moreText}>{t("Open challenge")}</Text></Affordance>
          </View>)}
        </View> : null}
        {groups.map(([heading, rows]) => <View key={heading || "_"}>
        <View style={styles.sectionHead}><Text style={styles.section}>{heading ? heading.toUpperCase() : t("CHANNELS")}</Text><Text style={styles.count}>{rows.length}</Text></View>
        {rows.map(channel => <Affordance key={channel.id} testID={`open-channel-${channel.id}`} onPress={() => router.push({ pathname: "/channel/[id]", params: { id: channel.id } })} style={styles.channel}><View style={styles.hash}>{channel.kind && channel.kind !== "text" ? <Ionicons name={KIND_ICONS[channel.kind]} size={18} color={colors.text} /> : <Text style={styles.hashText}>#</Text>}</View><View style={{ flex: 1 }}><Text style={[styles.channelName, !!channel.unread_count && styles.channelUnread]}>{channel.name}</Text><Text style={styles.channelDescription}>{channel.description || t(channel.kind && channel.kind !== "text" ? channel.kind.toUpperCase() : "Open conversation")}</Text></View>{channel.unread_count ? <View testID={`unread-${channel.id}`} style={styles.unreadBadge}><Text style={styles.unreadText}>{channel.unread_count >= 100 ? "99+" : channel.unread_count}</Text></View> : null}<Ionicons name="chevron-forward" size={18} color={colors.textDim} /></Affordance>)}
      </View>)}</> : null}

      {isActive && tab === "wall" ? <View testID="community-wall">
        <Composer communityId={community.id} onPublished={wall.prepend} />
        {wall.loading ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.lg }} /> : null}
        {wall.error ? <View accessibilityRole="alert" testID="wall-error"><Text style={styles.emptyText}>{wall.error}</Text><Affordance accessibilityRole="button" testID="wall-retry" onPress={() => void wall.load()}><Text style={styles.retry}>{t("Retry")}</Text></Affordance></View> : null}
        {!wall.loading && !wall.error && wall.posts.length === 0 ? <Text style={styles.emptyText}>{t("No posts on the wall yet. Start the conversation.")}</Text> : null}
        {wall.posts.map(post => <PostCard key={post.id} post={post} onChange={next => wall.patch(post.id, () => next)} onRemoved={() => wall.remove(post.id)} onReposted={wall.prepend} />)}
        {wall.hasMore ? <Affordance accessibilityRole="button" onPress={() => void wall.loadMore()} style={styles.leave}><Text style={styles.moreText}>{t("LOAD MORE")}</Text></Affordance> : null}
      </View> : null}

      {(!isActive || tab === "about") && !community.redacted ? <View style={styles.about} testID="community-about">
        <Text style={styles.section}>{t("ABOUT")}</Text>
        <Text style={styles.aboutText}>{community.description || t("A focused place to train and progress together.")}</Text>
        {community.rules?.length ? <>
          <Text style={[styles.section, { marginTop: spacing.lg }]}>{t("HOUSE RULES")}</Text>
          {community.rules.map((rule, index) => <View key={index} style={styles.rule}><Text style={styles.ruleNumber}>{index + 1}</Text><Text style={styles.aboutText}>{rule}</Text></View>)}
        </> : null}
        <Text style={[styles.section, { marginTop: spacing.lg }]}>{t("RUN BY")}</Text>
        <Affordance accessibilityRole="button" onPress={() => community.owner && router.push({ pathname: "/user/[id]", params: { id: community.owner.id } })} style={styles.memberRow}><Avatar user={community.owner} size={36} /><Text style={styles.channelName}>{community.owner?.full_name || t("Coach")}</Text></Affordance>
        <Text style={styles.channelDescription}>{t("Created {date}").replace("{date}", formatDate(community.created_at, { month: "long", year: "numeric" }))}</Text>
      </View> : null}

      {isActive && tab === "members" ? <View testID="community-members">
        {membersError ? <View accessibilityRole="alert" testID="members-error"><Text style={styles.emptyText}>{membersError}</Text><Affordance accessibilityRole="button" testID="members-retry" onPress={() => { setMembersError(""); setMembers(null); }}><Text style={styles.retry}>{t("Retry")}</Text></Affordance></View> : members === null ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.lg }} /> : members.map(person => <Affordance key={person.id} accessibilityRole="button" testID={`directory-${person.id}`} onPress={() => router.push({ pathname: "/user/[id]", params: { id: person.id } })} style={[styles.memberRow, { marginHorizontal: spacing.lg }]}><Avatar user={person} size={36} /><Text style={styles.channelName}>{person.full_name || t("Member")}</Text></Affordance>)}
      </View> : null}

      {isActive && membership?.role !== "owner" ? <Affordance accessibilityRole="button" testID="leave-community" disabled={busy} onPress={leave} style={[styles.leave, busy && { opacity: 0.4 }]}>
        <Ionicons name="exit-outline" size={15} color={colors.error} />
        <Text style={styles.leaveText}>{t(community.join_policy === "paid" ? "Leave and cancel subscription" : "Leave community")}</Text>
      </Affordance> : null}
    </ScrollView> : <Text style={styles.error}>{error}</Text>}
    <Modal visible={onboarding} transparent animationType="fade" onRequestClose={() => void finishOnboarding()}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modal} testID="community-welcome">
          <Text style={styles.kicker}>{t("WELCOME TO")}</Text>
          <Text style={[styles.title, { fontSize: 24 }]}>{community?.name}</Text>
          {community?.welcome_message ? <Text style={styles.aboutText}>{community.welcome_message}</Text> : null}
          {community?.rules?.length ? <>
            <Text style={[styles.section, { marginTop: spacing.md }]}>{t("HOUSE RULES")}</Text>
            {community.rules.map((rule, index) => <View key={index} style={styles.rule}><Text style={styles.ruleNumber}>{index + 1}</Text><Text style={styles.aboutText}>{rule}</Text></View>)}
          </> : null}
          <Affordance signal="brand" accessibilityRole="button" testID="accept-rules" onPress={() => void finishOnboarding()} style={[styles.joinButton, { marginTop: spacing.lg }]}><Text style={styles.joinButtonText}>{t(community?.rules?.length ? "I AGREE — LET'S GO" : "LET'S GO")}</Text></Affordance>
        </View>
      </View>
    </Modal>
    <ReportSheet target={reporting} onClose={() => setReporting(null)} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({ channelUnread: { color: colors.text, fontWeight: "900" }, unreadBadge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.text, alignItems: "center", justifyContent: "center", marginRight: 6 }, unreadText: { color: colors.bg, fontSize: 11, fontWeight: "900" }, invitePanel: { margin: spacing.lg, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.text, backgroundColor: colors.surface2, gap: spacing.sm }, inviteTitle: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 }, inviteLink: { color: colors.text, fontSize: 13 }, inviteHint: { color: colors.textDim, fontSize: 11 }, inviteRow: { flexDirection: "row", gap: spacing.sm }, inviteSecondary: { flex: 1, minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" }, inviteSecondaryText: { color: colors.text, fontSize: 12, fontWeight: "900" }, invitePrimary: { flex: 1, minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, invitePrimaryText: { color: colors.brandOn, fontSize: 12, fontWeight: "900" }, leave: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl }, leaveText: { color: colors.error, fontSize: 12, fontWeight: "800" }, moreText: { color: colors.text, fontWeight: "900", letterSpacing: 1 }, safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text, flex: 1 }, scroll: { paddingBottom: spacing.xxxl }, hero: { padding: spacing.xl, minHeight: 250, justifyContent: "flex-end", backgroundColor: colors.surface2, borderBottomWidth: 1, borderBottomColor: colors.border, overflow: "hidden" }, heroShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(9,10,9,0.55)" }, heroTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, communityAvatar: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.text }, kicker: { ...type.eyebrow, color: colors.text }, title: { ...type.screenTitle, fontSize: 34, marginTop: spacing.sm }, description: { color: colors.textMuted, lineHeight: 21, marginTop: spacing.md, maxWidth: 640 }, meta: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: spacing.lg }, metaText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" }, joinBand: { margin: spacing.lg, padding: spacing.lg, borderLeftWidth: 3, borderLeftColor: colors.text, backgroundColor: colors.surface2, flexDirection: "row", alignItems: "center", gap: spacing.md }, joinTitle: { color: colors.text, fontWeight: "900", fontSize: 13 }, joinCopy: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 }, joinButton: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, joinButtonText: { color: colors.brandOn, fontSize: 11, fontWeight: "900" }, notice: { marginHorizontal: spacing.lg, marginTop: spacing.sm, flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.warning }, noticeText: { color: colors.warning, flex: 1, fontSize: 12 }, tabs: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }, tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong }, tabOn: { borderColor: colors.text, backgroundColor: colors.surface2 }, tabText: { color: colors.textMuted, fontSize: 11, fontWeight: "900" }, tabTextOn: { color: colors.text }, sectionHead: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.sm }, section: { ...type.section, flex: 1 }, count: { color: colors.textDim }, channel: { marginHorizontal: spacing.lg, minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, hash: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }, hashText: { color: colors.text, fontWeight: "900", fontSize: 20 }, channelName: { color: colors.text, fontWeight: "800" }, channelDescription: { color: colors.textMuted, fontSize: 11, marginTop: 3 }, emptyText: { color: colors.textMuted, textAlign: "center", padding: spacing.xl }, about: { padding: spacing.lg, gap: spacing.sm }, aboutText: { color: colors.text, lineHeight: 21, flex: 1 }, rule: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }, ruleNumber: { color: colors.text, fontWeight: "900", width: 18 }, memberRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: spacing.lg }, modal: { width: "100%", maxWidth: 480, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.xl, gap: spacing.sm, borderWidth: 1, borderColor: colors.text }, retry: { color: colors.text, fontWeight: "900", textAlign: "center", paddingBottom: spacing.md }, error: { color: colors.error, padding: spacing.lg } });
