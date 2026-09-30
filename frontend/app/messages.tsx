import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, DmThread } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { Avatar } from "@/src/components/social/avatar";

export default function MessagesScreen() {
  const router = useRouter(); const { t, formatDate } = useI18n();
  const [threads, setThreads] = useState<DmThread[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const revision = useRef(0);
  const load = useCallback(async () => {
    const current = ++revision.current; setError("");
    try { const rows = await api.dmThreads(); if (current === revision.current) setThreads(rows); }
    catch { if (current === revision.current) setError(t("Something went wrong")); }
    finally { if (current === revision.current) setLoading(false); }
  }, [t]);
  useFocusEffect(useCallback(() => { setLoading(true); void load(); return () => { revision.current += 1; }; }, [load]));
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.headerTitle}>{t("MESSAGES")}</Text></View>
    <ScrollView contentContainerStyle={styles.scroll}>
      {loading ? <ActivityIndicator color={colors.text} /> : null}
      {error ? <View accessibilityRole="alert" style={styles.center}><Text style={styles.muted}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{t("Retry")}</Text></Pressable></View> : null}
      {!loading && !error && threads.length === 0 ? <View style={styles.center}><Ionicons name="chatbubbles-outline" size={36} color={colors.textDim} /><Text style={styles.muted}>{t("No conversations yet. Open a profile to start one with people you train with.")}</Text></View> : null}
      {threads.map(thread => <Pressable key={thread.peer?.id || thread.last_message.id} accessibilityRole="button" onPress={() => thread.peer && router.push({ pathname: "/dm/[id]", params: { id: thread.peer.id, name: thread.peer.full_name || "" } })} style={styles.row}>
        <Avatar user={thread.peer} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.name}>{thread.peer?.full_name || t("Member")}</Text><Text numberOfLines={1} style={styles.preview}>{thread.last_message.status === "deleted" ? t("Message deleted") : thread.last_message.content || (thread.last_message.media?.length ? t("📎 Attachment") : "")}</Text></View>
        <View style={styles.meta}><Text style={styles.time}>{formatDate(thread.last_message.created_at, { day: "numeric", month: "short" })}</Text>{thread.unread ? <View style={styles.badge}><Text style={styles.badgeText}>{thread.unread}</Text></View> : null}</View>
      </Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, scroll: { paddingBottom: spacing.xxxl }, center: { alignItems: "center", padding: spacing.xxl, gap: spacing.md }, muted: { color: colors.textMuted, textAlign: "center" }, retry: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: colors.brand, justifyContent: "center" }, retryText: { ...type.button, fontSize: 12 }, row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.text, fontWeight: "900" }, name: { color: colors.text, fontWeight: "800" }, preview: { color: colors.textMuted, fontSize: 13, marginTop: 2 }, meta: { alignItems: "flex-end", gap: 4 }, time: { color: colors.textDim, fontSize: 11 }, badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.text, alignItems: "center", justifyContent: "center" }, badgeText: { color: colors.bg, fontSize: 11, fontWeight: "900" } });
