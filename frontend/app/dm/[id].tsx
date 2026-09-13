import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, DirectMessage } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function DirectMessageScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>(); const router = useRouter(); const { user } = useAuth(); const { t, formatDate } = useI18n();
  const [messages, setMessages] = useState<DirectMessage[]>([]); const [draft, setDraft] = useState(""); const [sending, setSending] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const revision = useRef(0); const sendingRef = useRef(false);
  const load = useCallback(async () => {
    if (!id || sendingRef.current) return;
    const current = ++revision.current;
    try { const rows = await api.dmMessages(id); if (current !== revision.current) return; setMessages(rows); setError(""); }
    catch (cause) { if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Could not load messages")); }
    finally { if (current === revision.current) setLoading(false); }
  }, [id, t]);
  useFocusEffect(useCallback(() => {
    sendingRef.current = false; setSending(false); setMessages([]); setDraft(""); setLoading(true); setError(""); void load();
    const timer = setInterval(() => void load(), 8000);
    return () => { clearInterval(timer); revision.current += 1; };
  }, [load]));
  const send = async () => {
    if (!id || !draft.trim() || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setError("");
    const current = ++revision.current;
    try { const message = await api.sendDm(id, draft.trim()); if (current !== revision.current) return; setMessages(rows => [...rows.filter(row => row.id !== message.id), message]); setDraft(""); }
    catch (cause) { if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Could not send message")); }
    finally { if (current === revision.current) { sendingRef.current = false; setSending(false); } }
  };
  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><View style={{ flex: 1 }}><Text style={styles.headerTitle}>{name || t("Direct message")}</Text><Text style={styles.live}>{t("PRIVATE")}</Text></View></View>
    {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text></View> : null}
    {loading ? <ActivityIndicator color={colors.brand} /> : null}
    <FlatList data={messages} keyExtractor={item => item.id} contentContainerStyle={styles.list} ListEmptyComponent={!loading && !error ? <View style={styles.empty}><Ionicons name="lock-closed-outline" size={36} color={colors.textDim} /><Text style={styles.emptyText}>{t("Say hello. Only the two of you can read this.")}</Text></View> : null} renderItem={({ item }) => { const own = item.sender_id === user?.id; return <View style={[styles.message, own && styles.messageOwn]}><Text style={styles.messageText}>{item.content}</Text><Text style={styles.time}>{formatDate(item.created_at, { hour: "2-digit", minute: "2-digit" })}</Text></View>; }} />
    <View style={styles.composer}><TextInput value={draft} onChangeText={setDraft} editable={!sending} maxLength={4000} multiline placeholder={t("Message...")} placeholderTextColor={colors.textDim} style={styles.input} /><Pressable accessibilityRole="button" disabled={!draft.trim() || sending || loading} onPress={() => void send()} accessibilityLabel={t("Send message")} style={[styles.send, (!draft.trim() || sending || loading) && styles.disabled]}><Ionicons name="send" size={17} color={colors.brandOn} /></Pressable></View>
  </KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, live: { color: colors.brand, fontSize: 9, fontWeight: "900", marginTop: 3 }, list: { padding: spacing.lg, paddingBottom: spacing.xl }, message: { maxWidth: "86%", alignSelf: "flex-start", backgroundColor: colors.surface2, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm }, messageOwn: { alignSelf: "flex-end", backgroundColor: colors.brandDim }, messageText: { color: colors.text, lineHeight: 20 }, time: { color: colors.textDim, fontSize: 10, marginTop: 4, alignSelf: "flex-end" }, composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }, input: { flex: 1, minHeight: 44, maxHeight: 110, paddingHorizontal: spacing.md, paddingVertical: 11, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, color: colors.text, backgroundColor: colors.bg }, send: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, disabled: { opacity: 0.4 }, error: { color: colors.error, paddingHorizontal: spacing.lg, paddingTop: spacing.sm }, empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }, emptyText: { color: colors.textMuted, textAlign: "center" } });
