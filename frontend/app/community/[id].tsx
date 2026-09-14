import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, Community, CommunityChannel } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import * as Linking from "expo-linking";
import { MANAGE_CHANNEL, can } from "@/src/permissions";

export default function CommunityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { t, formatNumber, localeTag } = useI18n();
  const [community, setCommunity] = useState<Community | null>(null); const [channels, setChannels] = useState<CommunityChannel[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviting, setInviting] = useState(false);
  const load = useCallback(async () => { if (!id) return; try { const value = await api.community(id); setCommunity(value); if (value.membership?.status === "active") setChannels(await api.communityChannels(id)); else setChannels([]); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load community")); } }, [id, t]);
  useEffect(() => void load(), [load]);
  const join = async () => { if (!id || busy) return; setBusy(true); setError(""); try { await api.joinCommunity(id); await load(); } catch (cause) { const message = cause instanceof Error ? cause.message : t("Could not join community"); setError(message); } finally { setBusy(false); } };
  if (!community && !error) return <SafeAreaView style={styles.safe}><ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xxxl }} /></SafeAreaView>;
  // An owner leaving would orphan the community; they archive it instead.
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
    setInviting(true); setError("");
    try {
      const invite = await api.createInvite(id, {});
      setInviteLink(Linking.createURL(`/invite/${invite.code}`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not create invite")); }
    finally { setInviting(false); }
  };
  const membership = community?.membership; const isActive = membership?.status === "active"; const isManager = membership?.role === "owner" || membership?.role === "moderator" || channels.some(channel => can(channel.permissions, MANAGE_CHANNEL));
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text numberOfLines={1} style={styles.headerTitle}>{community?.name || t("COMMUNITY")}</Text>{isActive ? <Pressable accessibilityRole="button" accessibilityLabel={t("Invite people")} testID="invite-people" disabled={inviting} onPress={() => void createInvite()} style={styles.icon}><Ionicons name="person-add-outline" size={20} color={colors.brand} /></Pressable> : null}{isManager ? <Pressable onPress={() => router.push({ pathname: "/community/[id]/manage", params: { id } })} style={styles.icon}><Ionicons name="settings-outline" size={20} color={colors.brand} /></Pressable> : null}</View>
    {inviteLink ? <View style={styles.invitePanel} testID="invite-panel">
      <Text style={styles.inviteTitle}>{t("INVITE LINK")}</Text>
      <Text selectable style={styles.inviteLink} testID="invite-link">{inviteLink}</Text>
      <Text style={styles.inviteHint}>{t("Valid for 7 days. Anyone with the link can ask to join.")}</Text>
      <View style={styles.inviteRow}>
        <Pressable accessibilityRole="button" testID="invite-close" onPress={() => setInviteLink("")} style={styles.inviteSecondary}><Text style={styles.inviteSecondaryText}>{t("DONE")}</Text></Pressable>
        <Pressable accessibilityRole="button" testID="invite-share" onPress={() => void Share.share({ message: inviteLink }).catch(() => undefined)} style={styles.invitePrimary}><Text style={styles.invitePrimaryText}>{t("SHARE")}</Text></Pressable>
      </View>
    </View> : null}
    {community ? <ScrollView contentContainerStyle={styles.scroll}><View style={styles.hero}><Text style={styles.kicker}>{community.join_policy === "paid" ? t("PAID MEMBERSHIP") : community.join_policy === "approval" ? t("APPLICATION REQUIRED") : t("OPEN COMMUNITY")}</Text><Text style={styles.title}>{community.name}</Text><Text style={styles.description}>{community.description || t("A focused place to train and progress together.")}</Text><View style={styles.meta}><Ionicons name="people" size={16} color={colors.brand} /><Text style={styles.metaText}>{formatNumber(community.member_count)} {t("members")}</Text><Text style={styles.metaText}>· {community.owner?.full_name || t("Coach")}</Text></View></View>
      {!isActive ? <View style={styles.joinBand}><View style={{ flex: 1 }}><Text style={styles.joinTitle}>{membership?.status === "pending" ? t("REQUEST PENDING") : community.join_policy === "paid" ? new Intl.NumberFormat(localeTag, { style: "currency", currency: community.currency }).format(community.price_cents / 100) + t(" / month") : t("JOIN THE GROUP")}</Text><Text style={styles.joinCopy}>{membership?.status === "pending" ? t("A community manager will review your request.") : community.join_policy === "paid" ? t("Checkout will open when verified billing is connected.") : t("Get access to channels and member conversations.")}</Text></View>{membership?.status !== "pending" ? <Pressable onPress={join} disabled={busy} style={styles.joinButton}><Text style={styles.joinButtonText}>{t(community.join_policy === "paid" ? "CONTINUE" : community.join_policy === "approval" ? "REQUEST" : "JOIN")}</Text></Pressable> : null}</View> : null}
      {error ? <View style={styles.notice}><Ionicons name="information-circle" size={18} color={colors.warning} /><Text style={styles.noticeText}>{error}</Text></View> : null}
      {isActive ? <><View style={styles.sectionHead}><Text style={styles.section}>{t("CHANNELS")}</Text><Text style={styles.count}>{channels.length}</Text></View>{channels.map(channel => <Pressable key={channel.id} onPress={() => router.push({ pathname: "/channel/[id]", params: { id: channel.id } })} style={styles.channel}><View style={styles.hash}><Text style={styles.hashText}>#</Text></View><View style={{ flex: 1 }}><Text style={[styles.channelName, !!channel.unread_count && styles.channelUnread]}>{channel.name}</Text><Text style={styles.channelDescription}>{channel.description || t("Open conversation")}</Text></View>{channel.unread_count ? <View testID={`unread-${channel.id}`} style={styles.unreadBadge}><Text style={styles.unreadText}>{channel.unread_count >= 100 ? "99+" : channel.unread_count}</Text></View> : null}<Ionicons name="chevron-forward" size={18} color={colors.textDim} /></Pressable>)}</> : null}
      {isActive && membership?.role !== "owner" ? <Pressable accessibilityRole="button" testID="leave-community" disabled={busy} onPress={leave} style={[styles.leave, busy && { opacity: 0.4 }]}>
        <Ionicons name="exit-outline" size={15} color={colors.error} />
        <Text style={styles.leaveText}>{t("Leave community")}</Text>
      </Pressable> : null}
    </ScrollView> : <Text style={styles.error}>{error}</Text>}
  </SafeAreaView>;
}
const styles = StyleSheet.create({ channelUnread: { color: colors.text, fontWeight: "900" }, unreadBadge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", marginRight: 6 }, unreadText: { color: colors.brandOn, fontSize: 11, fontWeight: "900" }, invitePanel: { margin: spacing.lg, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.surface2, gap: spacing.sm }, inviteTitle: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 }, inviteLink: { color: colors.text, fontSize: 13 }, inviteHint: { color: colors.textDim, fontSize: 11 }, inviteRow: { flexDirection: "row", gap: spacing.sm }, inviteSecondary: { flex: 1, minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" }, inviteSecondaryText: { color: colors.text, fontSize: 12, fontWeight: "900" }, invitePrimary: { flex: 1, minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, invitePrimaryText: { color: colors.brandOn, fontSize: 12, fontWeight: "900" }, leave: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl }, leaveText: { color: colors.error, fontSize: 12, fontWeight: "800" }, safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text, flex: 1 }, scroll: { paddingBottom: spacing.xxxl }, hero: { padding: spacing.xl, minHeight: 250, justifyContent: "flex-end", backgroundColor: colors.surface2, borderBottomWidth: 1, borderBottomColor: colors.border }, kicker: { ...type.eyebrow, color: colors.brand }, title: { ...type.screenTitle, fontSize: 34, marginTop: spacing.sm }, description: { color: colors.textMuted, lineHeight: 21, marginTop: spacing.md, maxWidth: 640 }, meta: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: spacing.lg }, metaText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" }, joinBand: { margin: spacing.lg, padding: spacing.lg, borderLeftWidth: 3, borderLeftColor: colors.brand, backgroundColor: colors.surface2, flexDirection: "row", alignItems: "center", gap: spacing.md }, joinTitle: { color: colors.text, fontWeight: "900", fontSize: 13 }, joinCopy: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 }, joinButton: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, joinButtonText: { color: colors.brandOn, fontSize: 11, fontWeight: "900" }, notice: { marginHorizontal: spacing.lg, flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.warning }, noticeText: { color: colors.warning, flex: 1, fontSize: 12 }, sectionHead: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.sm }, section: { ...type.section, flex: 1 }, count: { color: colors.textDim }, channel: { marginHorizontal: spacing.lg, minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, hash: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: colors.brandDim, alignItems: "center", justifyContent: "center" }, hashText: { color: colors.brand, fontWeight: "900", fontSize: 20 }, channelName: { color: colors.text, fontWeight: "800" }, channelDescription: { color: colors.textMuted, fontSize: 11, marginTop: 3 }, error: { color: colors.error, padding: spacing.lg } });
