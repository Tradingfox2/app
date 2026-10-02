import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, AppNotification } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

/** Icon per notification kind; anything unrecognised still renders sensibly.
 *  `moderation_action` and `lab_report_ready` are the keys the backend actually
 *  writes — the previous `moderation` / `lab_report` entries never matched. */
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  follow: "person-add-outline",
  follow_request: "person-add",
  follow_accepted: "checkmark-circle-outline",
  post_like: "heart",
  post_comment: "chatbubble-outline",
  post_repost: "repeat",
  post_mention: "at",
  mention: "at",
  direct_message: "mail-outline",
  membership: "people-outline",
  coach_decision: "ribbon-outline",
  moderation_action: "shield-checkmark-outline",
  lab_report_ready: "flask-outline",
  lab_report: "flask-outline",
  community: "people-outline",
  comment_reply: "return-down-forward",
  comment_like: "heart-outline",
  live_session: "radio-outline",
  program_adopted: "barbell-outline",
  join_request: "person-add-outline",
  gym_reward: "gift-outline",
  weekly_review: "calendar-outline",
};

const PAGE = 30;

/**
 * "Ana and 3 others liked your post".
 *
 * The backend title names only the most recent actor, so the count is appended
 * here. Falls back to a generic line for rows written without a title.
 */
function summarise(row: AppNotification, t: (key: string) => string): string {
  const base = row.title?.trim() || t("New activity");
  const others = (row.actor_count ?? 0) - 1;
  return others > 0 ? `${base} ${t("and {count} others").replace("{count}", String(others))}` : base;
}

export default function NotificationsScreen() {
  const router = useRouter(); const { t, formatDate } = useI18n();
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<AppNotification | null>(null);
  const busy = useRef(false);
  const revision = useRef(0);
  const load = useCallback(async (only: boolean) => {
    const current = ++revision.current;
    try {
      const data = await api.notifications(only);
      if (current === revision.current) { setRows(data); setHasMore(data.length === PAGE); setError(""); }
    } catch (cause) {
      if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Could not load notifications"));
    } finally { if (current === revision.current) setLoading(false); }
  }, [t]);
  useFocusEffect(useCallback(() => {
    busy.current = false; setLoading(true); setError(""); void load(unreadOnly);
    return () => { revision.current += 1; };
  }, [load, unreadOnly]));

  const unread = rows.filter(row => !row.read_at).length;
  const markAll = async () => {
    if (busy.current || !unread) return;
    busy.current = true;
    try { await api.markAllNotificationsRead(); await load(unreadOnly); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busy.current = false; }
  };
  // Opening marks read and navigates; the read write must not block the jump.
  const open = async (row: AppNotification) => {
    if (!row.read_at) {
      setRows(current => current.map(item => item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item));
      api.markNotificationRead(row.id).catch(() => void load(unreadOnly));
    }
    if (row.type === "lab_report_ready" || row.type === "lab_report") {
      router.push("/labs");
      return;
    }
    if (row.type === "program_adopted") {
      router.push("/program");
      return;
    }
    if (row.type === "gym_reward") {
      router.push("/checkin");
      return;
    }
    const sessionId = row.metadata?.session_id;
    if (row.type === "live_session" && typeof sessionId === "string") {
      router.push({ pathname: "/live/[id]", params: { id: sessionId } });
      return;
    }
    const channelId = row.metadata?.channel_id;
    if (typeof channelId === "string") {
      router.push({ pathname: "/channel/[id]", params: { id: channelId } });
      return;
    }
    // Every event written through notify() carries target_type + target_id.
    const target = typeof row.metadata?.target_id === "string" ? row.metadata.target_id : null;
    if (target) {
      switch (row.metadata?.target_type) {
        case "user": return router.push({ pathname: "/user/[id]", params: { id: target } });
        case "dm": return router.push({ pathname: "/dm/[id]", params: { id: target } });
        case "community":
          if (row.metadata?.manage) return router.push({ pathname: "/community/[id]/manage", params: { id: target } });
          return router.push({ pathname: "/community/[id]", params: { id: target } });
        case "post": return router.push({ pathname: "/post/[id]", params: { id: target } });
        default: break;
      }
    }
    setSheet(row);
  };

  const more = async () => {
    const last = rows[rows.length - 1];
    if (!last || busy.current) return;
    busy.current = true;
    try {
      const page = await api.notifications(unreadOnly, last.id);
      setRows(current => [...current, ...page.filter(row => !current.some(existing => existing.id === row.id))]);
      setHasMore(page.length === PAGE);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busy.current = false; }
  };
  const remove = async (row: AppNotification) => {
    setRows(current => current.filter(item => item.id !== row.id));
    try { await api.deleteNotification(row.id); } catch { void load(unreadOnly); }
  };
  const clearRead = async () => {
    if (busy.current) return;
    busy.current = true;
    try { await api.clearReadNotifications(); await load(unreadOnly); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busy.current = false; }
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance>
      <View style={{ flex: 1 }}><Text style={styles.headerTitle}>{t("NOTIFICATIONS")}</Text>{unread ? <Text style={styles.live}>{t("{count} unread").replace("{count}", String(unread))}</Text> : null}</View>
      {unread ? <Affordance accessibilityRole="button" testID="mark-all-read" onPress={() => void markAll()} style={styles.icon}><Ionicons name="checkmark-done" size={20} color={colors.text} /></Affordance> : null}
      {rows.some(row => row.read_at) ? <Affordance accessibilityRole="button" accessibilityLabel={t("Clear read notifications")} testID="clear-read" onPress={() => void clearRead()} style={styles.icon}><Ionicons name="trash-bin-outline" size={19} color={colors.textMuted} /></Affordance> : null}
      <Affordance accessibilityRole="button" accessibilityLabel={t("Notification settings")} testID="notification-settings" onPress={() => router.push("/notification-settings")} style={styles.icon}><Ionicons name="options-outline" size={20} color={colors.textMuted} /></Affordance>
    </View>
    <View style={styles.tabs}>
      {([["all", t("ALL")], ["unread", t("UNREAD")]] as const).map(([key, label]) => {
        const on = (key === "unread") === unreadOnly;
        return <Affordance key={key} accessibilityRole="button" testID={`notifications-tab-${key}`} onPress={() => { setUnreadOnly(key === "unread"); setLoading(true); }} style={[styles.tab, on && styles.tabOn]}><Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text></Affordance>;
      })}
    </View>
    {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text><Affordance accessibilityRole="button" onPress={() => void load(unreadOnly)} style={styles.icon}><Text style={styles.retry}>{t("Retry")}</Text></Affordance></View> : null}
    {loading ? <ActivityIndicator accessibilityLabel={t("Loading...")} color={colors.text} /> : null}
    <FlatList
      data={rows}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={!loading && !error ? <View style={styles.empty}><Ionicons name="notifications-off-outline" size={36} color={colors.textDim} /><Text style={styles.emptyText}>{unreadOnly ? t("Nothing unread.") : t("No notifications yet.")}</Text></View> : null}
      renderItem={({ item }) => <Affordance accessibilityRole="button" testID={`notification-${item.id}`} onPress={() => void open(item)} style={[styles.row, !item.read_at && styles.rowUnread]}>
        <Ionicons name={ICONS[item.type] ?? "notifications-outline"} size={18} color={item.read_at ? colors.textDim : colors.text} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{summarise(item, t)}</Text>
          {item.body ? <Text numberOfLines={2} style={styles.body}>{item.body}</Text> : null}
          <Text style={styles.time}>{formatDate(item.created_at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
        </View>
        {!item.read_at ? <View testID={`unread-dot-${item.id}`} style={styles.dot} /> : null}
        <Affordance accessibilityRole="button" accessibilityLabel={t("Delete notification")} testID={`delete-notification-${item.id}`} onPress={() => void remove(item)} style={styles.icon}><Ionicons name="close" size={16} color={colors.textDim} /></Affordance>
      </Affordance>}
      ListFooterComponent={hasMore ? <Affordance accessibilityRole="button" testID="notifications-more" onPress={() => void more()} style={[styles.icon, { alignSelf: "center", width: "auto" }]}><Text style={styles.retry}>{t("LOAD MORE")}</Text></Affordance> : null}
    />
    <Modal visible={!!sheet} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
      <Affordance signal="none" style={styles.sheetBackdrop} onPress={() => setSheet(null)}>
        <Affordance signal="none" style={styles.sheet} testID="notification-sheet" onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title} testID="notification-sheet-title">{sheet ? summarise(sheet, t) : ""}</Text>
          {sheet?.body ? <Text style={styles.body} testID="notification-sheet-body">{sheet.body}</Text> : null}
          <Affordance accessibilityRole="button" accessibilityLabel={t("CLOSE")} testID="notification-sheet-close" onPress={() => setSheet(null)} style={styles.sheetClose}>
            <Text style={styles.retry}>{t("CLOSE")}</Text>
          </Affordance>
        </Affordance>
      </Affordance>
    </Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, live: { color: colors.text, fontSize: 9, fontWeight: "900", marginTop: 3 }, tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }, tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong }, tabOn: { borderColor: colors.text, backgroundColor: colors.surface2 }, tabText: { color: colors.textMuted, fontSize: 11, fontWeight: "900" }, tabTextOn: { color: colors.text }, list: { padding: spacing.lg, paddingBottom: spacing.xxxl }, row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, rowUnread: { backgroundColor: colors.surface2, paddingHorizontal: spacing.sm }, title: { color: colors.text, fontWeight: "800", fontSize: 13 }, body: { color: colors.textMuted, fontSize: 12, marginTop: 2 }, time: { color: colors.textDim, fontSize: 10, marginTop: 3 }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text }, empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }, emptyText: { color: colors.textMuted }, error: { color: colors.error, paddingHorizontal: spacing.lg }, retry: { color: colors.text, fontSize: 11, fontWeight: "900" }, sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end", padding: spacing.lg }, sheet: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border }, sheetClose: { minHeight: 44, alignItems: "center", justifyContent: "center" } });
