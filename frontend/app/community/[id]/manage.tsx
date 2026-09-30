import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { api, COMMUNITY_CATEGORIES, mediaUrl, type ChallengeMetric, type ChannelKind, type ChannelOverwrite, type Community, type CommunityAuditEntry, type CommunityCategory, type CommunityChannel, type CommunityInsights, type CommunityInvite, type CommunityReport, type CommunityRole, type Membership } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { KICK_MEMBER, MANAGE_MESSAGES, MANAGE_ROLES, PERMISSION_LIST, can, toggle as togglePermission } from "@/src/permissions";
import { Avatar } from "@/src/components/social/avatar";
import { METRIC_GLOSSARY } from "@/src/analytics-locales";
import { MetricGlossary } from "@/src/components/metric-glossary";
import { LISTED_PUBLICLY_LABEL, SAVE_LABEL, SAVED_LABEL, iconButtonA11y, joinPolicyPhrase, selectedControl } from "@/src/community-copy";
import * as Linking from "expo-linking";

const INSIGHT_CHIPS = [
  ["members", "MEMBERS"],
  ["joined_7d", "JOINED 7D"],
  ["joined_30d", "JOINED 30D"],
  ["messages_7d", "MESSAGES 7D"],
  ["messages_30d", "MESSAGES 30D"],
  ["active_members_7d", "ACTIVE 7D"],
] as const satisfies ReadonlyArray<readonly [keyof CommunityInsights, string]>;

/** Calendar date from a `YYYY-MM-DD` insights bucket, without a UTC day shift. */
function insightDay(isoDay: string, formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string) {
  const [year, month, day] = isoDay.split("-").map(Number);
  if (!year || !month || !day) return isoDay;
  return formatDate(new Date(year, month - 1, day), { day: "numeric", month: "short" });
}

const METRIC_LABELS: Record<ChallengeMetric, string> = {
  workouts: "WORKOUTS", active_days: "ACTIVE DAYS", minutes: "MINUTES", tonnage: "VOLUME",
};
const KINDS: ChannelKind[] = ["text", "announcement", "checkin", "challenge", "program", "live"];
const KIND_HINTS: Partial<Record<ChannelKind, string>> = {
  announcement: "Everyone reads; only managers post.",
  checkin: "One check-in per member per day. One rest day never breaks a streak; two in a row do.",
  program: "Coaches with the Post programs permission share training plans members can adopt.",
  live: "Schedule live sessions with a join link; members RSVP and are notified when you go live.",
};
const SLOWMODES = [0, 10, 30, 60, 300, 900];
const TIMEOUTS: [number, string][] = [[10, "10 min"], [60, "1 h"], [1440, "1 day"], [10080, "1 week"]];
const ROLE_COLORS = ["#9BE15D", "#5DA9E1", "#F5C542", "#FF8A00", "#E15D9B", "#B15DE1", "#FF453A", "#8A8F98"];

/** inherit -> allow -> deny -> inherit */
type Tri = "inherit" | "allow" | "deny";

export default function ManageCommunity() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { t, formatDate, formatNumber } = useI18n();
  const [members, setMembers] = useState<Membership[]>([]); const [channels, setChannels] = useState<CommunityChannel[]>([]); const [channelName, setChannelName] = useState(""); const [error, setError] = useState("");
  const [roles, setRoles] = useState<CommunityRole[]>([]); const [roleName, setRoleName] = useState("");
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [roleEdit, setRoleEdit] = useState<{ name: string; rank: string }>({ name: "", rank: "" });
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  const [overwriteRole, setOverwriteRole] = useState<string | null>(null);
  const [openMember, setOpenMember] = useState<string | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [settings, setSettings] = useState({ name: "", description: "" });
  const [extras, setExtras] = useState<{ category: CommunityCategory; is_public: boolean; join_policy: Community["join_policy"]; welcome_message: string; rules: string[] }>({ category: "general", is_public: true, join_policy: "open", welcome_message: "", rules: [] });
  const [newRule, setNewRule] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [channelEdit, setChannelEdit] = useState<{ description: string; category: string }>({ description: "", category: "" });
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState<string | null>(null);
  const [invites, setInvites] = useState<CommunityInvite[]>([]);
  const [channelKind, setChannelKind] = useState<ChannelKind>("text");
  const [newCategory, setNewCategory] = useState("");
  const [metric, setMetric] = useState<ChallengeMetric>("workouts");
  const [lengthDays, setLengthDays] = useState(14);
  const [goal, setGoal] = useState("");
  const [insights, setInsights] = useState<CommunityInsights | null>(null);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [audit, setAudit] = useState<CommunityAuditEntry[] | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberHits, setMemberHits] = useState<Membership[] | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [savedAction, setSavedAction] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while house rules, welcome text, or other batched fields differ from the server.
  const dirtyRef = useRef(false);
  // The caller's own powers, as the server resolved them per channel.
  const myMask = channels.reduce((mask, channel) => mask | (channel.permissions ?? 0), 0);
  const isOwner = community?.membership?.role === "owner";

  const load = useCallback(async () => {
    if (!id) return;
    const current = generation.current;
    try {
      const [memberRows, channelRows, roleRows, detail] = await Promise.all([
        api.communityMembers(id), api.communityChannels(id), api.communityRoles(id), api.community(id),
      ]);
      if (current !== generation.current) return;
      setMembers(memberRows); setChannels(channelRows); setRoles(roleRows); setCommunity(detail); setError("");
      // Defaulted, not trusted: the form reads these straight into .trim(), so a
      // payload missing either field would take the whole screen down.
      setSettings({ name: detail?.name ?? "", description: detail?.description ?? "" });
      setExtras({ category: detail?.category ?? "general", is_public: detail?.is_public ?? true, join_policy: detail?.join_policy ?? "open", welcome_message: detail?.welcome_message ?? "", rules: detail?.rules ?? [] });
      // Separate and non-fatal: a failure here must not blank the whole screen.
      api.communityInvites(id).then(rows => { if (current === generation.current) setInvites(rows); }).catch(() => undefined);
      // Only a well-formed payload renders; anything else hides the panel.
      api.communityInsights(id).then(row => { if (current === generation.current) setInsights(row && typeof row.members === "number" ? row : null); }).catch(() => undefined);
      api.communityReports(id).then(rows => { if (current === generation.current) setReports(Array.isArray(rows) ? rows : []); }).catch(() => setReports([]));
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : t("Could not load management tools"));
    } finally { if (current === generation.current) setLoading(false); }
  }, [id, t]);
  useFocusEffect(useCallback(() => {
    // Coming back to this screen reloads from the server. That would drop a rule
    // the member added and has not saved yet, so a dirty form stays as they left it.
    if (dirtyRef.current) return;
    generation.current += 1; busy.current = false; setReviewing(false);
    setMembers([]); setChannels([]); setRoles([]); setLoading(true); setError(""); setAudit(null);
    setOpenRole(null); setOpenChannel(null); setOverwriteRole(null); setOpenMember(null);
    setPendingAction(null); setSavedAction(null); setSettingsError("");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    void load();
    return () => { generation.current += 1; if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, [load]));
  // Every mutation is single-flight and re-reads from the server on success, so
  // a permission change can never be shown as applied when it was not.
  // `generic` keeps the fallback copy even when the server sent a reason, for the
  // actions that have always reported failure generically.
  const showSaved = (key: string) => {
    setSavedAction(key);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    const stamp = generation.current;
    savedTimer.current = setTimeout(() => {
      if (stamp !== generation.current) return;
      setSavedAction(current => current === key ? null : current);
    }, 2200);
  };
  // `actionId` keeps the spinner on that control. `onError` places the failure
  // beside it. A `false` result is a no-op, not a save.
  const run = async (action: () => Promise<boolean | void>, failure = "Something went wrong", generic = false, options?: { actionId?: string; onError?: (message: string) => void }) => {
    if (busy.current) return;
    const current = generation.current;
    busy.current = true;
    if (options?.actionId) setPendingAction(options.actionId);
    else setReviewing(true);
    setError("");
    options?.onError?.("");
    let succeeded = false;
    try {
      const result = await action();
      succeeded = result !== false;
    } catch (cause) {
      if (current === generation.current) {
        const message = !generic && cause instanceof Error ? cause.message : t(failure);
        if (options?.onError) options.onError(message);
        else setError(message);
      }
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setPendingAction(null);
        setReviewing(false);
        if (succeeded && options?.actionId) showSaved(options.actionId);
      }
    }
  };
  const review = (memberId: string, status: "active" | "rejected" | "removed" | "banned") => run(async () => {
    if (!id) return;
    await api.reviewCommunityMember(id, memberId, status); await load();
  });
  const addChannel = () => run(async () => {
    if (!id || channelName.trim().length < 2) return;
    // A challenge starts now and runs for the chosen length; the server
    // rejects anything backwards or longer than 92 days.
    const starts = new Date();
    const challenge = channelKind === "challenge" ? {
      metric,
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + lengthDays * 86_400_000).toISOString(),
      goal: goal.trim() ? Number(goal) : null,
    } : undefined;
    await api.createCommunityChannel(id, channelName.trim(), "", { kind: channelKind, challenge, category: newCategory.trim() || undefined });
    setChannelName(""); setGoal(""); setChannelKind("text"); setNewCategory(""); await load();
  }, "Could not create channel");
  const publishChannel = (channel: CommunityChannel, value: boolean) => run(async () => {
    const updated = await api.updateChannelRanking(channel.id, value);
    setChannels(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
  }, "Something went wrong", true);
  const moveChannel = (channel: CommunityChannel, delta: number) => run(async () => {
    if (!id) return;
    const ids = channels.map(row => row.id);
    const index = ids.indexOf(channel.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await api.reorderChannels(id, ids); await load();
  }, "Could not reorder channels");
  const saveChannelDetails = (channel: CommunityChannel) => run(async () => {
    await api.updateChannel(channel.id, { description: channelEdit.description.trim(), category: channelEdit.category.trim() });
    await load();
  }, "Could not update the channel", false, { actionId: `channel-${channel.id}` });
  const setSlowmode = (channel: CommunityChannel, seconds: number) => run(async () => {
    await api.updateChannel(channel.id, { slowmode_sec: seconds });
    setChannels(rows => rows.map(row => row.id === channel.id ? { ...row, slowmode_sec: seconds } : row));
  }, "Could not update the channel");
  const addRole = () => run(async () => {
    if (!id || roleName.trim().length < 2) return;
    await api.createRole(id, { name: roleName.trim() }); setRoleName(""); await load();
  }, "Could not create role");
  const removeRole = (role: CommunityRole) => run(async () => {
    await api.deleteRole(role.id);
    if (openRole === role.id) setOpenRole(null);
    if (overwriteRole === role.id) setOverwriteRole(null);
    await load();
  }, "Could not delete role");
  const flipPermission = (role: CommunityRole, bit: number) => run(async () => {
    const updated = await api.updateRole(role.id, { permissions: togglePermission(role.permissions, bit) });
    setRoles(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
  }, "Could not update role");
  const saveRole = (role: CommunityRole, changes: Partial<Pick<CommunityRole, "name" | "color" | "rank">>, actionId?: string) => run(async () => {
    const updated = await api.updateRole(role.id, changes);
    setRoles(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
  }, "Could not update role", false, actionId ? { actionId } : undefined);
  const cycleOverwrite = (channel: CommunityChannel, roleId: string, bit: number) => run(async () => {
    const existing = channel.overwrites ?? [];
    const current = existing.find(row => row.role_id === roleId) ?? { role_id: roleId, allow: 0, deny: 0 };
    const state: Tri = can(current.allow, bit) ? "allow" : can(current.deny, bit) ? "deny" : "inherit";
    const next: ChannelOverwrite =
      state === "inherit" ? { ...current, allow: current.allow | bit, deny: current.deny & ~bit }
      : state === "allow" ? { ...current, allow: current.allow & ~bit, deny: current.deny | bit }
      : { ...current, allow: current.allow & ~bit, deny: current.deny & ~bit };
    const overwrites = [...existing.filter(row => row.role_id !== roleId), next]
      .filter(row => row.allow !== 0 || row.deny !== 0);  // drop rows that say nothing
    const updated = await api.setChannelOverwrites(channel.id, overwrites);
    setChannels(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
  }, "Could not update channel permissions");
  const flipMemberRole = (member: Membership, roleId: string) => run(async () => {
    if (!id) return;
    const currentRoles = member.role_ids ?? [];
    const nextRoles = currentRoles.includes(roleId)
      ? currentRoles.filter(row => row !== roleId)
      : [...currentRoles, roleId];
    await api.assignMemberRoles(id, member.id, nextRoles); await load();
  }, "Could not update member roles");

  const saveSettings = () => {
    if (!id || settings.name.trim().length < 3) {
      setSettingsError(t("Could not update the community"));
      return;
    }
    void run(async () => {
      // Name and description always travel; everything else only when it changed,
      // so an untouched form sends exactly what it always has. Success is still
      // announced on the button when nothing else moved.
      const changed: Parameters<typeof api.updateCommunity>[1] = {};
      if (community && extras.category !== (community.category ?? "general")) changed.category = extras.category;
      if (community && extras.is_public !== community.is_public) changed.is_public = extras.is_public;
      if (community && extras.join_policy !== community.join_policy) changed.join_policy = extras.join_policy;
      if (community && extras.welcome_message !== (community.welcome_message ?? "")) changed.welcome_message = extras.welcome_message.trim();
      if (community && JSON.stringify(extras.rules) !== JSON.stringify(community.rules ?? [])) changed.rules = extras.rules;
      const updated = await api.updateCommunity(id, { name: settings.name.trim(), description: settings.description.trim(), ...changed });
      setCommunity(updated);
      setSettings({ name: updated?.name ?? "", description: updated?.description ?? "" });
      setExtras({ category: updated?.category ?? "general", is_public: updated?.is_public ?? true, join_policy: updated?.join_policy ?? "open", welcome_message: updated?.welcome_message ?? "", rules: updated?.rules ?? [] });
    }, "Could not update the community", false, { actionId: "settings", onError: setSettingsError });
  };
  const uploadImage = (field: "cover_media_id" | "avatar_media_id") => run(async () => {
    if (!id) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error(t("Photo library access is needed to attach media."));
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: field === "cover_media_id" ? [16, 9] : [1, 1] });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = asset.mimeType || "image/jpeg";
    const uploaded = await api.uploadMedia({ uri: asset.uri, name: asset.fileName || `community.${mime.split("/")[1]}`, mimeType: mime });
    setCommunity(await api.updateCommunity(id, { [field]: uploaded.id }));
  }, "Could not upload the image");
  const renameChannel = (channel: CommunityChannel) => run(async () => {
    if (renameTo.trim().length < 2) return false;
    await api.updateChannel(channel.id, { name: renameTo.trim() });
    setRenaming(null); setRenameTo(""); await load();
  }, "Could not rename the channel", false, { actionId: `rename-${channel.id}` });
  const archiveChannel = (channel: CommunityChannel) => run(async () => {
    await api.archiveChannel(channel.id);
    if (openChannel === channel.id) setOpenChannel(null);
    await load();
  }, "Could not archive the channel");
  // A kick: out, but free to come back. Banning is the separate, heavier action.
  const removeMember = (member: Membership) => run(async () => {
    if (!id) return;
    await api.reviewCommunityMember(id, member.id, "removed");
    if (openMember === member.id) setOpenMember(null);
    await load();
  }, "Could not remove the member");
  const banMember = (member: Membership) => run(async () => {
    if (!id) return;
    await api.reviewCommunityMember(id, member.id, "banned");
    if (openMember === member.id) setOpenMember(null);
    await load();
  }, "Could not ban the member");
  const timeout = (member: Membership, minutes: number) => run(async () => {
    if (!id) return;
    await api.timeoutMember(id, member.id, minutes); await load();
  }, "Could not time the member out");
  const transfer = (member: Membership) => run(async () => {
    if (!id) return;
    await api.transferCommunity(id, member.id);
    router.replace({ pathname: "/community/[id]", params: { id } });
  }, "Could not transfer the community");
  const archiveCommunity = () => run(async () => {
    if (!id) return;
    await api.archiveCommunity(id);
    router.replace("/community");
  }, "Could not archive the community");
  const resolveReport = (report: CommunityReport, resolution: "dismissed" | "content_removed") => run(async () => {
    if (!id) return;
    await api.reviewCommunityReport(id, report.id, resolution);
    setReports(rows => rows.filter(row => row.id !== report.id));
  }, "Could not resolve the report");
  const loadAudit = () => run(async () => { if (id) setAudit(await api.communityAuditLog(id)); }, "Could not load the audit log");

  const createInvite = (skipApproval: boolean) => run(async () => {
    if (!id) return;
    await api.createInvite(id, { skip_approval: skipApproval });
    setInvites(await api.communityInvites(id));
  }, "Could not create invite");
  const revokeInvite = (code: string) => run(async () => {
    await api.revokeInvite(code);
    setInvites(rows => rows.filter(row => row.code !== code));
  }, "Could not revoke invite");

  const pending = members.filter(member => member.status === "pending");
  // A name search asks the server, so it finds members beyond the loaded page.
  const active = (memberHits ?? members).filter(member => member.status === "active");
  const searchMembers = (value: string) => {
    setMemberQuery(value);
    if (!id || value.trim().length < 2) { setMemberHits(null); return; }
    api.communityMembers(id, { q: value.trim(), status: "active" }).then(setMemberHits).catch(() => setMemberHits([]));
  };
  const banned = members.filter(member => member.status === "banned");
  const disabled = reviewing || loading || pendingAction !== null;
  const settingsBusy = pendingAction === "settings";
  const settingsSaved = savedAction === "settings";
  const settingsUnsaved = !!community && (
    settings.name !== (community.name ?? "")
    || settings.description !== (community.description ?? "")
    || extras.category !== (community.category ?? "general")
    || extras.is_public !== community.is_public
    || extras.join_policy !== community.join_policy
    || extras.welcome_message !== (community.welcome_message ?? "")
    || JSON.stringify(extras.rules) !== JSON.stringify(community.rules ?? [])
  );
  const settingsDirty = newRule.trim().length > 0 || settingsUnsaved;
  dirtyRef.current = settingsDirty && !leaving;
  const requestLeave = () => {
    if (settingsDirty) setConfirmLeave(true);
    else router.back();
  };
  usePreventRemove(settingsDirty && !leaving, () => setConfirmLeave(true));
  useEffect(() => {
    if (leaving) router.back();
  }, [leaving, router]);
  const sparkDays = insights?.daily_messages ?? [];
  const sparkTotal = sparkDays.reduce((sum, day) => sum + day.messages, 0);
  const confirmMark = (actionId: string, hint: string, blocked: boolean, onPress: () => void, testID: string) => {
    const pending = pendingAction === actionId;
    const saved = savedAction === actionId;
    const label = t(saved ? SAVED_LABEL : SAVE_LABEL);
    return <Pressable {...iconButtonA11y(label, hint)} accessibilityState={{ disabled: blocked || pending, busy: pending }} testID={testID} disabled={blocked || pending} onPress={onPress} style={[styles.approve, (blocked || pending) && !pending && { opacity: 0.4 }]}>
      {pending ? <ActivityIndicator color={colors.brandOn} size="small" /> : <Ionicons name={saved ? "checkmark-done" : "checkmark"} size={18} color={colors.brandOn} />}
    </Pressable>;
  };
  const triFor = (channel: CommunityChannel, roleId: string, bit: number): Tri => {
    const row = (channel.overwrites ?? []).find(entry => entry.role_id === roleId);
    if (!row) return "inherit";
    return can(row.allow, bit) ? "allow" : can(row.deny, bit) ? "deny" : "inherit";
  };
  const timedOut = (member: Membership) => member.timeout_until && new Date(member.timeout_until).getTime() > Date.now();

  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel={t("Back")} testID="manage-back" onPress={requestLeave} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.headerTitle}>{t("MANAGE COMMUNITY")}</Text></View>{confirmLeave ? <View style={styles.leaveRow} testID="unsaved-settings"><Text style={styles.error}>{t("Unsaved changes will be lost")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Stay")} testID="unsaved-stay" onPress={() => setConfirmLeave(false)} style={styles.action}><Text style={styles.actionText}>{t("Stay")}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t("Leave")} testID="unsaved-leave" onPress={() => { dirtyRef.current = false; setConfirmLeave(false); setLeaving(true); }} style={styles.action}><Text style={styles.actionText}>{t("Leave")}</Text></Pressable></View> : null}<ScrollView contentContainerStyle={styles.scroll}>
    {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" disabled={reviewing} onPress={() => void load()} style={styles.icon}><Text style={styles.active}>{t("Retry")}</Text></Pressable></View> : null}
    {loading || reviewing ? <ActivityIndicator color={colors.text} /> : null}

    {insights ? <>
      <Text style={styles.section}>{t("INSIGHTS")}</Text>
      <View style={styles.stats} testID="insights">
        {INSIGHT_CHIPS.map(([key, label]) => {
          const value = insights[key];
          return (
            <MetricGlossary
              key={key}
              testID={`insights-metric-${key}`}
              value={formatNumber(value)}
              label={t(label)}
              glossary={t(METRIC_GLOSSARY[key])}
              style={styles.stat}
              valueStyle={styles.statValue}
              labelStyle={styles.meta}
            />
          );
        })}
      </View>
      <MetricGlossary testID="insights-engagement" glossary={t(METRIC_GLOSSARY.engagement_rate_7d)}>
        <Text style={styles.meta}>{t("{pct}% of members posted this week · {left} left in 30 days · {pending} pending").replace("{pct}", String(Math.round(insights.engagement_rate_7d * 100))).replace("{left}", String(insights.left_30d)).replace("{pending}", String(insights.pending))}</Text>
      </MetricGlossary>
      {sparkDays.length ? <>
        <Text style={styles.meta} testID="insights-chart-label">{t("{count} messages · {start} – {end}", { count: formatNumber(sparkTotal), start: insightDay(sparkDays[0].day, formatDate), end: insightDay(sparkDays[sparkDays.length - 1].day, formatDate) })}</Text>
        <View style={styles.sparkline} testID="insights-chart" accessibilityLabel={t("{count} messages · {start} – {end}", { count: formatNumber(sparkTotal), start: insightDay(sparkDays[0].day, formatDate), end: insightDay(sparkDays[sparkDays.length - 1].day, formatDate) })}>{sparkDays.map(day => {
          const peak = Math.max(...sparkDays.map(row => row.messages), 1);
          return <View key={day.day} accessibilityLabel={t("{count} messages · {date}", { count: formatNumber(day.messages), date: insightDay(day.day, formatDate) })} style={[styles.bar, { height: Math.max(3, Math.round((day.messages / peak) * 44)) }]} />;
        })}</View>
      </> : null}
      {insights.top_channels?.length ? <Text style={styles.meta}>{t("Busiest")}: {insights.top_channels.map(row => `#${row.name} (${row.messages})`).join(" · ")}</Text> : null}
    </> : null}

    <Text style={styles.section}>{t("COMMUNITY SETTINGS")}</Text>
    <View style={styles.imagesRow}>
      <Pressable {...iconButtonA11y(t("Community photo"), t("Upload a community photo"))} testID="upload-avatar" disabled={disabled} onPress={() => void uploadImage("avatar_media_id")} style={styles.avatarBox}>
        {community?.avatar_url ? <Image source={{ uri: mediaUrl(community.avatar_url) }} style={styles.fill} accessibilityIgnoresInvertColors /> : <Ionicons name="image-outline" size={22} color={colors.textDim} />}
      </Pressable>
      <Pressable {...iconButtonA11y(t("Cover image"), t("Upload a cover image"))} testID="upload-cover" disabled={disabled} onPress={() => void uploadImage("cover_media_id")} style={styles.coverBox}>
        {community?.cover_url ? <Image source={{ uri: mediaUrl(community.cover_url) }} style={styles.fill} accessibilityIgnoresInvertColors /> : <Text style={styles.meta}>{t("Tap to add a cover image")}</Text>}
      </Pressable>
    </View>
    <TextInput value={settings.name} onChangeText={value => setSettings(current => ({ ...current, name: value }))} maxLength={80} editable={!disabled} placeholder={t("Community name")} placeholderTextColor={colors.textDim} style={styles.input} testID="settings-name" />
    <TextInput value={settings.description} onChangeText={value => setSettings(current => ({ ...current, description: value }))} maxLength={1200} multiline editable={!disabled} placeholder={t("Who is this community for?")} placeholderTextColor={colors.textDim} style={[styles.input, styles.multiline]} testID="settings-description" />
    <Text style={styles.meta}>{t("Category")}</Text>
    <View style={styles.chipRow}>{COMMUNITY_CATEGORIES.map(category => <Pressable key={category} accessibilityRole="button" {...selectedControl(extras.category === category)} testID={`settings-category-${category}`} onPress={() => setExtras(current => ({ ...current, category }))} style={[styles.chip, extras.category === category && styles.chipOn]}><Text style={styles.chipText}>{t(category.replace("_", " ").toUpperCase())}</Text></Pressable>)}</View>
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}><Text style={styles.name}>{t(LISTED_PUBLICLY_LABEL)}</Text><Text style={styles.meta}>{t("Private communities are hidden from discovery and joined by invite only.")}</Text></View>
      <Switch testID="settings-public" accessibilityLabel={t(LISTED_PUBLICLY_LABEL)} accessibilityHint={t("Show this community in search and rankings.")} value={extras.is_public} disabled={disabled} onValueChange={value => setExtras(current => ({ ...current, is_public: value }))} trackColor={{ true: colors.text }} />
    </View>
    {community?.join_policy !== "paid" ? <>
      <Text style={styles.meta}>{t("Who can join")}</Text>
      <View style={styles.chipRow}>{(["open", "approval"] as const).map(policy => <Pressable key={policy} accessibilityRole="button" {...selectedControl(extras.join_policy === policy)} testID={`settings-policy-${policy}`} onPress={() => setExtras(current => ({ ...current, join_policy: policy }))} style={[styles.chip, extras.join_policy === policy && styles.chipOn]}><Text style={styles.chipText}>{t(joinPolicyPhrase(policy))}</Text></Pressable>)}</View>
    </> : null}
    <Text style={styles.meta}>{t("Welcome message — shown once to each new member")}</Text>
    <TextInput value={extras.welcome_message} onChangeText={value => setExtras(current => ({ ...current, welcome_message: value }))} maxLength={1000} multiline editable={!disabled} placeholder={t("Welcome! Start by introducing yourself in #general...")} placeholderTextColor={colors.textDim} style={[styles.input, styles.multiline]} testID="settings-welcome" />
    <Text style={styles.meta}>{t("House rules")}</Text>
    {extras.rules.map((rule, index) => <View key={index} style={styles.ruleRow}>
      <Text style={styles.active}>{index + 1}</Text><Text style={[styles.checkLabel]}>{rule}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Remove rule")} testID={`remove-rule-${index}`} onPress={() => setExtras(current => ({ ...current, rules: current.rules.filter((_, i) => i !== index) }))} style={styles.icon}><Ionicons name="close" size={16} color={colors.textDim} /></Pressable>
    </View>)}
    {extras.rules.length < 15 ? <View style={styles.addRow}><TextInput value={newRule} onChangeText={setNewRule} maxLength={300} placeholder={t("Add a rule")} placeholderTextColor={colors.textDim} style={styles.input} testID="new-rule" /><Pressable {...iconButtonA11y(t("Add rule"), t("Not saved until you save."))} testID="add-rule" disabled={!newRule.trim() || disabled} onPress={() => { setExtras(current => ({ ...current, rules: [...current.rules, newRule.trim()] })); setNewRule(""); }} style={[styles.approve, (!newRule.trim() || disabled) && { opacity: 0.4 }]}><Ionicons name="add" size={20} color={colors.brandOn} /></Pressable></View> : null}
    {community && JSON.stringify(extras.rules) !== JSON.stringify(community.rules ?? []) ? <Text style={styles.meta} testID="rules-unsaved">{t("Not saved until you save.")}</Text> : null}
    {settingsUnsaved ? <Text style={styles.meta} testID="settings-unsaved">{t("Not saved until you save.")}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={t(settingsSaved ? SAVED_LABEL : SAVE_LABEL)} accessibilityState={{ disabled: disabled || settings.name.trim().length < 3, busy: settingsBusy }} testID="save-settings" disabled={disabled || settings.name.trim().length < 3} onPress={saveSettings} style={[styles.primary, ((disabled && !settingsBusy) || settings.name.trim().length < 3) && { opacity: 0.4 }]}>
      {settingsBusy ? <ActivityIndicator color={colors.brandOn} /> : <Text style={styles.primaryText}>{t(settingsSaved ? SAVED_LABEL : SAVE_LABEL)}</Text>}
    </Pressable>
    {settingsError ? <Text accessibilityRole="alert" testID="save-settings-error" style={styles.error}>{settingsError}</Text> : null}

    {can(myMask, MANAGE_MESSAGES) ? <>
      <Text style={styles.section}>{t("MODERATION QUEUE")}</Text>
      {reports.length ? reports.map(report => <View key={report.id} style={styles.reportRow} testID={`community-report-${report.id}`}>
        <Text style={styles.name}>{t(report.reason.replace("_", " "))} · {report.reported_user?.full_name || t("Member")}</Text>
        {report.content_snapshot ? <Text style={styles.snapshot} numberOfLines={3}>“{report.content_snapshot}”</Text> : null}
        {report.detail ? <Text style={styles.meta}>{report.detail}</Text> : null}
        <View style={styles.addRow}>
          <Pressable accessibilityRole="button" testID={`dismiss-report-${report.id}`} disabled={disabled} onPress={() => void resolveReport(report, "dismissed")} style={[styles.action, { flex: 1 }]}><Text style={styles.actionText}>{t("DISMISS")}</Text></Pressable>
          <Pressable accessibilityRole="button" testID={`remove-reported-${report.id}`} disabled={disabled} onPress={() => void resolveReport(report, "content_removed")} style={[styles.dangerSolid, { flex: 1 }]}><Text style={styles.dangerSolidText}>{t("REMOVE CONTENT")}</Text></Pressable>
        </View>
      </View>) : <Text style={styles.empty}>{t("Nothing reported. The queue is clear.")}</Text>}
    </> : null}

    <Text style={styles.section}>{t("JOIN REQUESTS")}</Text>{pending.length ? pending.map(member => <View key={member.id} style={styles.row}><Avatar user={member.user} size={32} /><View style={{ flex: 1 }}><Text style={styles.name}>{member.user?.full_name || t("Member")}</Text><Text style={styles.meta}>{t("Awaiting review")}</Text></View><Pressable accessibilityRole="button" disabled={reviewing} accessibilityLabel={t("Reject")} onPress={() => void review(member.id, "rejected")} style={[styles.icon, { opacity: reviewing ? 0.4 : 1 }]}><Ionicons name="close" size={20} color={colors.error} /></Pressable><Pressable accessibilityRole="button" disabled={reviewing} accessibilityLabel={t("Approve")} onPress={() => void review(member.id, "active")} style={[styles.approve, { opacity: reviewing ? 0.4 : 1 }]}><Ionicons name="checkmark" size={20} color={colors.brandOn} /></Pressable></View>) : !loading && !error ? <Text style={styles.empty}>{t("No pending requests")}</Text> : null}

    <Text style={styles.section}>{t("INVITE LINKS")}</Text>
    <Text style={styles.meta}>{t("A standard link still goes through approval. A direct link admits people straight in.")}</Text>
    {invites.map(invite => <View key={invite.code} style={styles.row} testID={`invite-${invite.code}`}>
      <View style={{ flex: 1 }}>
        <Text selectable numberOfLines={1} style={styles.name}>{Linking.createURL(`/invite/${invite.code}`)}</Text>
        <Text style={styles.meta}>{t(invite.skip_approval ? "Direct" : "Standard")} · {t("{count} used").replace("{count}", String(invite.uses))}{invite.max_uses ? ` / ${invite.max_uses}` : ""}{invite.unusable_reason ? ` · ${t(invite.unusable_reason)}` : ""}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Revoke")} testID={`revoke-${invite.code}`} disabled={disabled} onPress={() => void revokeInvite(invite.code)} style={styles.icon}><Ionicons name="close-circle-outline" size={20} color={colors.error} /></Pressable>
    </View>)}
    <View style={styles.addRow}>
      <Pressable accessibilityRole="button" testID="create-invite-standard" disabled={disabled} onPress={() => void createInvite(false)} style={[styles.action, { flex: 1 }]}><Text style={styles.actionText}>{t("NEW LINK")}</Text></Pressable>
      <Pressable accessibilityRole="button" testID="create-invite-direct" disabled={disabled} onPress={() => void createInvite(true)} style={[styles.action, { flex: 1 }]}><Text style={styles.actionText}>{t("NEW DIRECT LINK")}</Text></Pressable>
    </View>

    <Text style={styles.section}>{t("ROLES")}</Text>
    <Text style={styles.meta}>{t("Roles grant baseline powers. Channels can override them below. You can only grant powers you hold, to roles below your own.")}</Text>
    {roles.map(role => <View key={role.id}>
      <Pressable accessibilityRole="button" testID={`role-${role.id}`} onPress={() => { setOpenRole(openRole === role.id ? null : role.id); setRoleEdit({ name: role.name, rank: String(role.rank) }); }} style={styles.row}>
        <View style={[styles.swatch, { backgroundColor: role.color }]} />
        <View style={{ flex: 1 }}><Text style={styles.name}>{role.name}</Text><Text style={styles.meta}>{role.is_default ? t("Applies to everyone") : `${t("Rank")} ${role.rank}`}</Text></View>
        <Ionicons name={openRole === role.id ? "chevron-up" : "chevron-down"} size={16} color={colors.textDim} />
      </Pressable>
      {openRole === role.id ? <View style={styles.panel} testID={`role-panel-${role.id}`}>
        {!role.is_default ? <>
          <View style={styles.addRow}>
            <TextInput value={roleEdit.name} onChangeText={name => setRoleEdit(current => ({ ...current, name }))} maxLength={32} style={styles.input} testID={`role-name-${role.id}`} />
            <TextInput value={roleEdit.rank} onChangeText={rank => setRoleEdit(current => ({ ...current, rank: rank.replace(/[^0-9]/g, "") }))} maxLength={3} keyboardType="number-pad" style={[styles.input, { flex: 0, width: 64 }]} testID={`role-rank-${role.id}`} />
            {confirmMark(`role-${role.id}`, t("Save this role"), disabled || roleEdit.name.trim().length < 2, () => void saveRole(role, { name: roleEdit.name.trim(), rank: Math.max(1, Number(roleEdit.rank) || role.rank) }, `role-${role.id}`), `role-save-${role.id}`)}
          </View>
          <View style={styles.chipRow}>{ROLE_COLORS.map(color => <Pressable key={color} accessibilityRole="button" accessibilityLabel={color} testID={`role-color-${role.id}-${color}`} onPress={() => void saveRole(role, { color })} style={[styles.colorDot, { backgroundColor: color }, role.color === color && styles.colorOn]} />)}</View>
        </> : null}
        {PERMISSION_LIST.map(entry => <Pressable key={entry.key} accessibilityRole="checkbox" accessibilityState={{ checked: can(role.permissions, entry.bit) }} testID={`role-${role.id}-${entry.key}`} disabled={disabled} onPress={() => void flipPermission(role, entry.bit)} style={styles.checkRow}>
          <Ionicons name={can(role.permissions, entry.bit) ? "checkbox" : "square-outline"} size={17} color={can(role.permissions, entry.bit) ? colors.text : colors.textDim} />
          <Text style={styles.checkLabel}>{t(entry.label)}</Text>
        </Pressable>)}
        {role.is_default
          ? <Text style={styles.meta}>{t("The default role cannot be deleted.")}</Text>
          : <Pressable accessibilityRole="button" testID={`delete-role-${role.id}`} disabled={disabled} onPress={() => void removeRole(role)} style={styles.danger}><Ionicons name="trash-outline" size={15} color={colors.error} /><Text style={styles.dangerText}>{t("Delete role")}</Text></Pressable>}
      </View> : null}
    </View>)}
    <View style={styles.addRow}><TextInput value={roleName} onChangeText={setRoleName} maxLength={32} editable={!disabled} placeholder={t("new-role")} placeholderTextColor={colors.textDim} style={styles.input} testID="new-role-name" /><Pressable accessibilityRole="button" testID="create-role" disabled={disabled || roleName.trim().length < 2} accessibilityLabel={t("Create role")} onPress={() => void addRole()} style={[styles.approve, { opacity: disabled || roleName.trim().length < 2 ? 0.4 : 1 }]}><Ionicons name="add" size={20} color={colors.brandOn} /></Pressable></View>

    <Text style={styles.section}>{t("CHANNELS")}</Text>
    <Text style={styles.meta}>{t("Publish channel name and opted-in contributor count in rankings. Messages remain members-only. Public communities only.")}</Text>
    {channels.map((channel, index) => <View key={channel.id}>
      <View style={styles.row}>
        <Text style={styles.hash}>#</Text>
        <Pressable accessibilityRole="button" testID={`channel-${channel.id}`} onPress={() => { setOpenChannel(openChannel === channel.id ? null : channel.id); setOverwriteRole(null); setChannelEdit({ description: channel.description ?? "", category: channel.category ?? "" }); }} style={{ flex: 1 }}>
          <Text style={styles.name}>{channel.name}</Text>
          <Text style={styles.meta}>{channel.is_default ? t("DEFAULT") : t((channel.kind ?? "text").toUpperCase())}{channel.category ? ` · ${channel.category}` : ""}{channel.slowmode_sec ? ` · ${t("slow {n}s").replace("{n}", String(channel.slowmode_sec))}` : ""}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Move up")} testID={`move-up-${channel.id}`} disabled={disabled || index === 0} onPress={() => void moveChannel(channel, -1)} style={[styles.small, index === 0 && { opacity: 0.3 }]}><Ionicons name="chevron-up" size={16} color={colors.text} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Move down")} testID={`move-down-${channel.id}`} disabled={disabled || index === channels.length - 1} onPress={() => void moveChannel(channel, 1)} style={[styles.small, index === channels.length - 1 && { opacity: 0.3 }]}><Ionicons name="chevron-down" size={16} color={colors.text} /></Pressable>
        <Switch testID={`ranking-${channel.id}`} accessibilityLabel={t("Publish channel in rankings")} value={channel.ranking_opt_in ?? false} disabled={disabled} onValueChange={value => void publishChannel(channel, value)} trackColor={{ true: colors.text }} />
      </View>
      {openChannel === channel.id ? <View style={styles.panel} testID={`channel-panel-${channel.id}`}>
        <View style={styles.addRow}>
          <TextInput value={renaming === channel.id ? renameTo : ""} onChangeText={value => { setRenaming(channel.id); setRenameTo(value); }} maxLength={50} editable={!disabled} placeholder={t("Rename channel")} placeholderTextColor={colors.textDim} style={styles.input} testID={`rename-input-${channel.id}`} />
          {confirmMark(`rename-${channel.id}`, t("Save the channel name"), disabled || renaming !== channel.id || renameTo.trim().length < 2, () => void renameChannel(channel), `rename-${channel.id}`)}
        </View>
        <TextInput value={channelEdit.description} onChangeText={description => setChannelEdit(current => ({ ...current, description }))} maxLength={300} placeholder={t("Channel topic")} placeholderTextColor={colors.textDim} style={[styles.input, { marginTop: spacing.sm }]} testID={`channel-topic-${channel.id}`} />
        <View style={styles.addRow}>
          <TextInput value={channelEdit.category} onChangeText={category => setChannelEdit(current => ({ ...current, category }))} maxLength={32} placeholder={t("Category heading (e.g. Training)")} placeholderTextColor={colors.textDim} style={styles.input} testID={`channel-category-${channel.id}`} />
          {confirmMark(`channel-${channel.id}`, t("Save the channel topic"), disabled, () => void saveChannelDetails(channel), `channel-save-${channel.id}`)}
        </View>
        <Text style={styles.meta}>{t("Slow mode")}</Text>
        <View style={styles.chipRow}>{SLOWMODES.map(seconds => <Pressable key={seconds} accessibilityRole="button" {...selectedControl((channel.slowmode_sec ?? 0) === seconds)} testID={`slowmode-${channel.id}-${seconds}`} disabled={disabled} onPress={() => void setSlowmode(channel, seconds)} style={[styles.chip, (channel.slowmode_sec ?? 0) === seconds && styles.chipOn]}><Text style={styles.chipText}>{seconds === 0 ? t("OFF") : seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</Text></Pressable>)}</View>
        {channel.is_default
          ? <Text style={styles.meta}>{t("The default channel cannot be archived.")}</Text>
          : <Pressable accessibilityRole="button" testID={`archive-channel-${channel.id}`} disabled={disabled} onPress={() => void archiveChannel(channel)} style={styles.danger}>
              <Ionicons name="archive-outline" size={15} color={colors.error} />
              <Text style={styles.dangerText}>{t("Archive channel")}</Text>
            </Pressable>}
        {can(myMask, MANAGE_ROLES) ? <>
          <Text style={styles.meta}>{t("Pick a role, then tap a permission to cycle inherit → allow → deny.")}</Text>
          <View style={styles.chipRow}>{roles.map(role => <Pressable key={role.id} accessibilityRole="button" testID={`overwrite-role-${channel.id}-${role.id}`} onPress={() => setOverwriteRole(overwriteRole === role.id ? null : role.id)} style={[styles.chip, overwriteRole === role.id && styles.chipOn]}><Text style={styles.chipText}>{role.name}</Text></Pressable>)}</View>
          {overwriteRole ? PERMISSION_LIST.map(entry => {
            const state = triFor(channel, overwriteRole, entry.bit);
            return <Pressable key={entry.key} accessibilityRole="button" accessibilityLabel={`${t(entry.label)}: ${t(state)}`} testID={`overwrite-${channel.id}-${overwriteRole}-${entry.key}`} disabled={disabled} onPress={() => void cycleOverwrite(channel, overwriteRole, entry.bit)} style={styles.checkRow}>
              <Ionicons name={state === "allow" ? "checkmark-circle" : state === "deny" ? "close-circle" : "remove-circle-outline"} size={17} color={state === "allow" ? colors.text : state === "deny" ? colors.error : colors.textDim} />
              <Text style={styles.checkLabel}>{t(entry.label)}</Text>
              <Text style={styles.meta}>{t(state)}</Text>
            </Pressable>;
          }) : null}
        </> : <Text style={styles.meta}>{t("Channel permission overrides need the Manage roles permission.")}</Text>}
      </View> : null}
    </View>)}
    <Text style={styles.meta}>{t("Channel type")}</Text>
    <View style={styles.chipRow}>{KINDS.map(kind => (
      <Pressable key={kind} accessibilityRole="button" testID={`channel-kind-${kind}`} onPress={() => setChannelKind(kind)} style={[styles.chip, channelKind === kind && styles.chipOn]}>
        <Text style={styles.chipText}>{t(kind.toUpperCase())}</Text>
      </Pressable>))}
    </View>
    {KIND_HINTS[channelKind] ? <Text style={styles.meta}>{t(KIND_HINTS[channelKind]!)}</Text> : null}
    {channelKind === "challenge" ? <View style={styles.panel} testID="challenge-settings">
      <Text style={styles.meta}>{t("Only members who join are scored, from their finished workouts.")}</Text>
      <View style={styles.chipRow}>{(["workouts", "active_days", "minutes", "tonnage"] as ChallengeMetric[]).map(item => (
        <Pressable key={item} accessibilityRole="button" testID={`challenge-metric-${item}`} onPress={() => setMetric(item)} style={[styles.chip, metric === item && styles.chipOn]}>
          <Text style={styles.chipText}>{t(METRIC_LABELS[item])}</Text>
        </Pressable>))}
      </View>
      <View style={styles.chipRow}>{[7, 14, 30].map(days => (
        <Pressable key={days} accessibilityRole="button" testID={`challenge-length-${days}`} onPress={() => setLengthDays(days)} style={[styles.chip, lengthDays === days && styles.chipOn]}>
          <Text style={styles.chipText}>{t("{count} days").replace("{count}", String(days))}</Text>
        </Pressable>))}
      </View>
      <TextInput value={goal} onChangeText={value => setGoal(value.replace(/[^0-9]/g, ""))} keyboardType="number-pad" maxLength={7} placeholder={t("Group goal (optional)")} placeholderTextColor={colors.textDim} style={styles.input} testID="challenge-goal" />
    </View> : null}
    <TextInput value={newCategory} onChangeText={setNewCategory} maxLength={32} editable={!disabled} placeholder={t("Category heading (optional)")} placeholderTextColor={colors.textDim} style={[styles.input, { marginTop: spacing.sm }]} testID="new-channel-category" />
    <View style={styles.addRow}><TextInput value={channelName} onChangeText={setChannelName} maxLength={50} editable={!disabled} placeholder={t("new-channel")} placeholderTextColor={colors.textDim} style={styles.input} /><Pressable accessibilityRole="button" disabled={disabled || channelName.trim().length < 2} accessibilityLabel={t("Create channel")} onPress={() => void addChannel()} style={[styles.approve, { opacity: disabled || channelName.trim().length < 2 ? 0.4 : 1 }]}><Ionicons name="add" size={20} color={colors.brandOn} /></Pressable></View>

    <Text style={styles.section}>{t("ALL MEMBERS")}</Text>
    <TextInput value={memberQuery} onChangeText={searchMembers} maxLength={80} placeholder={t("Search members by name")} placeholderTextColor={colors.textDim} style={styles.input} testID="member-search" />
    {memberHits && memberHits.length === 0 ? <Text style={styles.empty}>{t("No members match.")}</Text> : null}
    {active.map(member => {
      const assigned = member.role_ids ?? [];
      return <View key={member.id}>
        <Pressable accessibilityRole="button" testID={`member-${member.id}`} onPress={() => setOpenMember(openMember === member.id ? null : member.id)} style={styles.row}>
          <Avatar user={member.user} size={32} />
          <View style={{ flex: 1 }}><Text style={styles.name}>{member.user?.full_name || t("Member")}</Text><Text style={styles.meta}>{t(member.role.toUpperCase())}{assigned.length ? ` · ${assigned.map(roleId => roles.find(role => role.id === roleId)?.name).filter(Boolean).join(", ")}` : ""}{timedOut(member) ? ` · ${t("TIMED OUT")}` : ""}</Text></View>
          <Text style={styles.active}>{t("ACTIVE")}</Text>
        </Pressable>
        {openMember === member.id ? <View style={styles.panel} testID={`member-panel-${member.id}`}>
          {roles.filter(role => !role.is_default).length
            ? roles.filter(role => !role.is_default).map(role => <Pressable key={role.id} accessibilityRole="checkbox" accessibilityState={{ checked: assigned.includes(role.id) }} testID={`member-${member.id}-role-${role.id}`} disabled={disabled} onPress={() => void flipMemberRole(member, role.id)} style={styles.checkRow}>
              <Ionicons name={assigned.includes(role.id) ? "checkbox" : "square-outline"} size={17} color={assigned.includes(role.id) ? colors.text : colors.textDim} />
              <Text style={styles.checkLabel}>{role.name}</Text>
            </Pressable>)
            : <Text style={styles.meta}>{t("Create a role to assign it here.")}</Text>}
          {member.role === "owner"
            ? <Text style={styles.meta}>{t("The owner cannot be removed.")}</Text>
            : <>
              {can(myMask, KICK_MEMBER) ? <>
                <Text style={styles.meta}>{t(timedOut(member) ? "Timed out until {date}" : "Time out (read-only for a while)").replace("{date}", member.timeout_until ? formatDate(member.timeout_until, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "")}</Text>
                <View style={styles.chipRow}>
                  {TIMEOUTS.map(([minutes, label]) => <Pressable key={minutes} accessibilityRole="button" testID={`timeout-${member.id}-${minutes}`} disabled={disabled} onPress={() => void timeout(member, minutes)} style={styles.chip}><Text style={styles.chipText}>{t(label)}</Text></Pressable>)}
                  {timedOut(member) ? <Pressable accessibilityRole="button" testID={`timeout-clear-${member.id}`} disabled={disabled} onPress={() => void timeout(member, 0)} style={[styles.chip, styles.chipOn]}><Text style={styles.chipText}>{t("LIFT")}</Text></Pressable> : null}
                </View>
              </> : null}
              <Pressable accessibilityRole="button" testID={`remove-member-${member.id}`} disabled={disabled} onPress={() => void removeMember(member)} style={styles.danger}>
                <Ionicons name="person-remove-outline" size={15} color={colors.error} />
                <Text style={styles.dangerText}>{t("Remove from community")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" testID={`ban-member-${member.id}`} disabled={disabled} onPress={() => void banMember(member)} style={styles.danger}>
                <Ionicons name="ban-outline" size={15} color={colors.error} />
                <Text style={styles.dangerText}>{t("Ban — they cannot rejoin")}</Text>
              </Pressable>
              {isOwner ? confirmTransfer === member.id
                ? <View style={styles.addRow}>
                    <Pressable accessibilityRole="button" onPress={() => setConfirmTransfer(null)} style={[styles.action, { flex: 1 }]}><Text style={styles.actionText}>{t("Cancel")}</Text></Pressable>
                    <Pressable accessibilityRole="button" testID={`confirm-transfer-${member.id}`} disabled={disabled} onPress={() => void transfer(member)} style={[styles.dangerSolid, { flex: 1 }]}><Text style={styles.dangerSolidText}>{t("HAND OVER")}</Text></Pressable>
                  </View>
                : <Pressable accessibilityRole="button" testID={`transfer-${member.id}`} disabled={disabled} onPress={() => setConfirmTransfer(member.id)} style={styles.danger}>
                    <Ionicons name="swap-horizontal" size={15} color={colors.warning} />
                    <Text style={[styles.dangerText, { color: colors.warning }]}>{t("Make owner (you stay on as moderator)")}</Text>
                  </Pressable> : null}
            </>}
        </View> : null}
      </View>;
    })}

    {banned.length ? <>
      <Text style={styles.section}>{t("BANNED")}</Text>
      {banned.map(member => <View key={member.id} style={styles.row} testID={`banned-${member.id}`}>
        <Avatar user={member.user} size={32} />
        <Text style={styles.name}>{member.user?.full_name || t("Member")}</Text>
        <Pressable accessibilityRole="button" testID={`unban-${member.id}`} disabled={disabled} onPress={() => void review(member.id, "removed")} style={styles.action}><Text style={styles.actionText}>{t("UNBAN")}</Text></Pressable>
      </View>)}
    </> : null}

    <Text style={styles.section}>{t("AUDIT LOG")}</Text>
    {audit === null
      ? <Pressable accessibilityRole="button" testID="load-audit" disabled={disabled} onPress={() => void loadAudit()} style={styles.action}><Text style={styles.actionText}>{t("SHOW RECENT ACTIONS")}</Text></Pressable>
      : audit.length === 0 ? <Text style={styles.empty}>{t("No moderation actions yet.")}</Text>
      : audit.map(entry => <View key={entry.id} style={styles.auditRow} testID={`audit-${entry.id}`}>
          <Text style={styles.name}>{entry.actor?.full_name || t("Member")} · {entry.action.replace("community.", "").replace(/_/g, " ")}</Text>
          <Text style={styles.meta}>{formatDate(entry.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
        </View>)}

    {isOwner ? <>
      <Text style={styles.section}>{t("DANGER ZONE")}</Text>
      <Text style={styles.meta}>{t("Archiving hides the community and its channels. Messages are kept, and you can restore it from the Community tab.")}</Text>
      {confirmArchive
        ? <View style={styles.addRow}>
            <Pressable accessibilityRole="button" testID="cancel-archive" disabled={disabled} onPress={() => setConfirmArchive(false)} style={[styles.action, { flex: 1 }]}>
              <Text style={styles.actionText}>{t("Cancel")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" testID="confirm-archive-community" disabled={disabled} onPress={() => void archiveCommunity()} style={[styles.dangerSolid, disabled && { opacity: 0.4 }]}>
              <Text style={styles.dangerSolidText}>{t("ARCHIVE")}</Text>
            </Pressable>
          </View>
        : <Pressable accessibilityRole="button" testID="archive-community" disabled={disabled} onPress={() => setConfirmArchive(true)} style={styles.danger}>
            <Ionicons name="archive-outline" size={15} color={colors.error} />
            <Text style={styles.dangerText}>{t("Archive community")}</Text>
          </Pressable>}
    </> : null}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, small: { width: 30, height: 30, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl }, section: { ...type.section, marginTop: spacing.xl, marginBottom: spacing.sm }, row: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, name: { color: colors.text, fontWeight: "800", flex: 1 }, meta: { color: colors.textMuted, fontSize: 10, marginTop: 3 }, approve: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, active: { color: colors.text, fontSize: 10, fontWeight: "900" }, hash: { color: colors.text, fontSize: 20, fontWeight: "900" }, empty: { color: colors.textMuted, paddingVertical: spacing.lg }, addRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }, input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: colors.text }, error: { color: colors.error }, swatch: { width: 10, height: 10, borderRadius: 5 }, panel: { paddingVertical: spacing.sm, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.borderStrong, marginBottom: spacing.sm }, checkRow: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.sm }, checkLabel: { color: colors.text, fontSize: 13, flex: 1 }, danger: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, minHeight: 40 }, dangerText: { color: colors.error, fontSize: 12, fontWeight: "800" }, chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: spacing.sm }, chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong }, chipOn: { borderColor: colors.text, backgroundColor: colors.surface2 }, chipText: { color: colors.text, fontSize: 11, fontWeight: "800" }, action: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" }, actionText: { color: colors.text, fontSize: 12, fontWeight: "800" }, multiline: { minHeight: 80, paddingTop: spacing.sm, textAlignVertical: "top", marginTop: spacing.sm }, primary: { minHeight: 48, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", marginTop: spacing.md }, primaryText: { color: colors.brandOn, fontWeight: "900", fontSize: 12, letterSpacing: 1 }, dangerSolid: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" }, dangerSolidText: { color: colors.text, fontWeight: "900", fontSize: 12, letterSpacing: 1 }, stats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg }, stat: { minWidth: 70 }, statValue: { color: colors.text, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] }, sparkline: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 48, marginTop: spacing.sm }, bar: { flex: 1, backgroundColor: colors.text, borderRadius: 1 }, imagesRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm }, avatarBox: { width: 72, height: 72, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", overflow: "hidden" }, coverBox: { flex: 1, height: 72, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", overflow: "hidden" }, fill: { width: "100%", height: "100%" }, switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md }, ruleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, colorDot: { width: 26, height: 26, borderRadius: 13 }, colorOn: { borderWidth: 3, borderColor: colors.text }, reportRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 }, snapshot: { color: colors.text, fontStyle: "italic" }, auditRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, leaveRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm } });
