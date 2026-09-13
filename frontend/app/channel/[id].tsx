import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, CommunityChannel, CommunityMessage } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { ADD_REACTION, DEFAULT_MEMBER, MANAGE_MESSAGES, PIN_MESSAGE, SEND_MESSAGE, can } from "@/src/permissions";
import { useRealtimeChannel } from "@/src/realtime";

const QUICK_REACTIONS = ["💪", "🔥", "👏", "🎯", "😂"];
const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Polling cadence with realtime down, and the slower reconcile when it is up. */
const POLL_MS = 8000;
const RECONCILE_MS = 45000;

export default function ChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { user } = useAuth(); const { t, formatDate } = useI18n();
  const [messages, setMessages] = useState<CommunityMessage[]>([]); const [draft, setDraft] = useState(""); const [sending, setSending] = useState(false); const [error, setError] = useState("");
  const [channel, setChannel] = useState<CommunityChannel | null>(null);
  const [replyTo, setReplyTo] = useState<CommunityMessage | null>(null);
  const [editing, setEditing] = useState<CommunityMessage | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const revision = useRef(0);
  const sendingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  // Fall back to the baseline grant when the payload carries no mask, so an
  // older server never silently locks the composer. The API enforces regardless.
  const mask = channel?.permissions ?? DEFAULT_MEMBER;
  const readOnly = !!channel && !can(mask, SEND_MESSAGE);
  const pins = messages.filter(item => item.pinned_at);
  const load = useCallback(async () => {
    if (!id || sendingRef.current) return;
    const requestRevision = ++revision.current;
    try {
      const [meta, rows] = await Promise.all([api.channel(id), api.channelMessages(id)]);
      if (requestRevision !== revision.current) return;
      setChannel(meta); setMessages(rows); setError("");
    } catch (cause) {
      if (requestRevision === revision.current) setError(cause instanceof Error ? cause.message : t("Could not load messages"));
    } finally {
      if (requestRevision === revision.current) setLoading(false);
    }
  }, [id, t]);
  // Realtime is additive: a publication appends only what we do not already
  // have, so it can never duplicate or clobber an optimistic row.
  const { connected } = useRealtimeChannel(id ? `channel:${id}` : null, event => {
    if (event.type !== "message.created") return;
    const incoming = event.message as CommunityMessage | undefined;
    if (!incoming?.id || incoming.channel_id !== id) return;
    setMessages(current => current.some(item => item.id === incoming.id) ? current : [...current, incoming]);
  });
  useFocusEffect(useCallback(() => {
    sendingRef.current = false; setSending(false);
    setMessages([]); setDraft(""); setLoading(true); setError(""); setReplyTo(null); setEditing(null); setActionsFor(null); setPinsOpen(false); void load();
    return () => { revision.current += 1; };
  }, [load]));
  // The timer never fully stops: with realtime up it drops to a slow reconcile,
  // so a missed publication cannot leave the channel permanently stale.
  useFocusEffect(useCallback(() => {
    const timer = setInterval(() => void load(), connected ? RECONCILE_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [load, connected]));
  // One in-flight mutation at a time: the poll above would otherwise overwrite
  // an optimistic row before the server echoes it back.
  const mutate = async (action: () => Promise<void>, failure: string) => {
    if (sendingRef.current) return;
    sendingRef.current = true; setSending(true); setError("");
    const mutationRevision = ++revision.current;
    try { await action(); }
    catch (cause) { if (mutationRevision === revision.current) setError(cause instanceof Error ? cause.message : t(failure)); }
    finally { if (mutationRevision === revision.current) { sendingRef.current = false; setSending(false); setLoading(false); } }
  };
  const send = () => mutate(async () => {
    if (!id || !draft.trim()) return;
    if (editing) {
      const updated = await api.editMessage(editing.id, draft.trim());
      setMessages(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
      setEditing(null);
    } else {
      const message = await api.createChannelMessage(id, draft.trim(), replyTo?.id ?? null);
      setMessages(current => [...current.filter(item => item.id !== message.id), message]);
      setReplyTo(null);
    }
    setDraft("");
  }, editing ? "Could not edit message" : "Could not send message");
  const react = (message: CommunityMessage, emoji: string) => mutate(async () => {
    const mine = message.reactions?.find(row => row.emoji === emoji)?.user_ids.includes(user?.id ?? "");
    const updated = mine ? await api.removeReaction(message.id, emoji) : await api.addReaction(message.id, emoji);
    setMessages(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    setActionsFor(null);
  }, "Could not react");
  const togglePin = (message: CommunityMessage) => mutate(async () => {
    if (message.pinned_at) { await api.unpinMessage(message.id); setMessages(current => current.map(item => item.id === message.id ? { ...item, pinned_at: null } : item)); }
    else { const updated = await api.pinMessage(message.id); setMessages(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item)); }
    setActionsFor(null);
  }, "Could not pin message");
  const remove = (message: CommunityMessage) => mutate(async () => {
    await api.deleteMessage(message.id);
    setMessages(current => current.filter(item => item.id !== message.id));
    setActionsFor(null);
  }, "Could not delete message");
  const startEdit = (message: CommunityMessage) => { setEditing(message); setReplyTo(null); setDraft(message.content); setActionsFor(null); };
  const canEdit = (message: CommunityMessage) => message.author_id === user?.id && Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MS;
  const canDelete = (message: CommunityMessage) => message.author_id === user?.id || can(mask, MANAGE_MESSAGES);

  const renderMessage = ({ item }: { item: CommunityMessage }) => {
    const own = item.author_id === user?.id;
    const open = actionsFor === item.id;
    return <View style={[styles.message, own && styles.messageOwn]} testID={`message-${item.id}`}>
      {item.pinned_at ? <View style={styles.pinnedTag}><Ionicons name="pin" size={10} color={colors.brand} /><Text style={styles.pinnedText}>{t("PINNED")}</Text></View> : null}
      {item.reply_to ? <View style={styles.replyQuote}><Text numberOfLines={1} style={styles.replyQuoteText}>{item.reply_to.content}</Text></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t("Message actions")} testID={`message-actions-${item.id}`} onLongPress={() => setActionsFor(open ? null : item.id)} delayLongPress={250}>
        <View style={styles.messageHead}><Text style={styles.author}>{own ? t("You") : item.author?.full_name || t("Member")}</Text><Text style={styles.time}>{formatDate(item.created_at, { hour: "2-digit", minute: "2-digit" })}</Text>{item.edited_at ? <Text style={styles.time}>{t("edited")}</Text> : null}</View>
        <Text style={styles.messageText}>{item.content}</Text>
      </Pressable>
      {item.reactions?.length ? <View style={styles.reactionRow}>{item.reactions.map(row => {
        const mine = row.user_ids.includes(user?.id ?? "");
        return <Pressable key={row.emoji} accessibilityRole="button" testID={`reaction-${item.id}-${row.emoji}`} disabled={!can(mask, ADD_REACTION)} onPress={() => react(item, row.emoji)} style={[styles.pill, mine && styles.pillMine]}><Text style={styles.pillText}>{row.emoji} {row.user_ids.length}</Text></Pressable>;
      })}</View> : null}
      {open ? <View style={styles.actions} testID={`actions-${item.id}`}>
        {can(mask, ADD_REACTION) ? QUICK_REACTIONS.map(emoji => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`${t("React")} ${emoji}`} testID={`react-${item.id}-${emoji}`} onPress={() => react(item, emoji)} style={styles.action}><Text style={styles.actionEmoji}>{emoji}</Text></Pressable>) : null}
        {can(mask, SEND_MESSAGE) ? <Pressable accessibilityRole="button" testID={`reply-${item.id}`} onPress={() => { setReplyTo(item); setEditing(null); setActionsFor(null); }} style={styles.action}><Ionicons name="return-down-back" size={15} color={colors.text} /></Pressable> : null}
        {can(mask, PIN_MESSAGE) ? <Pressable accessibilityRole="button" testID={`pin-${item.id}`} onPress={() => togglePin(item)} style={styles.action}><Ionicons name={item.pinned_at ? "pin-outline" : "pin"} size={15} color={colors.text} /></Pressable> : null}
        {canEdit(item) ? <Pressable accessibilityRole="button" testID={`edit-${item.id}`} onPress={() => startEdit(item)} style={styles.action}><Ionicons name="pencil" size={15} color={colors.text} /></Pressable> : null}
        {canDelete(item) ? <Pressable accessibilityRole="button" testID={`delete-${item.id}`} onPress={() => remove(item)} style={styles.action}><Ionicons name="trash-outline" size={15} color={colors.error} /></Pressable> : null}
      </View> : null}
    </View>;
  };

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <View style={{ flex: 1 }}><Text style={styles.headerTitle}># {channel?.name || t("CHANNEL")}</Text><Text style={styles.live}>{channel?.kind && channel.kind !== "text" ? t(channel.kind.toUpperCase()) : t("MEMBER CHAT")}</Text></View>
      {pins.length ? <Pressable accessibilityRole="button" testID="toggle-pins" onPress={() => setPinsOpen(open => !open)} style={styles.icon}><Ionicons name="pin" size={18} color={pinsOpen ? colors.brand : colors.text} /></Pressable> : null}
    </View>
    {pinsOpen && pins.length ? <View style={styles.pinsDrawer} testID="pins-drawer">{pins.map(item => <Text key={item.id} numberOfLines={1} style={styles.pinsItem}>{item.content}</Text>)}</View> : null}
    {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.icon}><Text style={styles.author}>{t("Retry")}</Text></Pressable></View> : null}
    {loading ? <ActivityIndicator accessibilityLabel={t("Loading...")} color={colors.brand} /> : null}
    <FlatList data={messages} keyExtractor={item => item.id} contentContainerStyle={styles.list} ListEmptyComponent={!loading && !error ? <View style={styles.empty}><Ionicons name="chatbubbles-outline" size={36} color={colors.textDim} /><Text style={styles.emptyText}>{t("Start the conversation")}</Text></View> : null} renderItem={renderMessage} />
    {replyTo ? <View style={styles.contextBar} testID="reply-bar"><Ionicons name="return-down-back" size={14} color={colors.brand} /><Text numberOfLines={1} style={styles.contextText}>{replyTo.content}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Cancel")} testID="cancel-reply" onPress={() => setReplyTo(null)}><Ionicons name="close" size={16} color={colors.textDim} /></Pressable></View> : null}
    {editing ? <View style={styles.contextBar} testID="edit-bar"><Ionicons name="pencil" size={14} color={colors.brand} /><Text numberOfLines={1} style={styles.contextText}>{t("Editing message")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Cancel")} testID="cancel-edit" onPress={() => { setEditing(null); setDraft(""); }}><Ionicons name="close" size={16} color={colors.textDim} /></Pressable></View> : null}
    {readOnly
      ? <View style={styles.readOnly} testID="composer-read-only"><Ionicons name="lock-closed-outline" size={14} color={colors.textDim} /><Text style={styles.readOnlyText}>{t("Only channel managers can post here.")}</Text></View>
      : <View style={styles.composer}><TextInput value={draft} onChangeText={setDraft} editable={!sending} maxLength={4000} multiline placeholder={t("Message the channel...")} placeholderTextColor={colors.textDim} style={styles.input} testID="composer-input" /><Pressable accessibilityRole="button" disabled={!draft.trim() || sending || loading} onPress={send} accessibilityLabel={t("Send message")} testID="composer-send" style={[styles.send, (!draft.trim() || sending || loading) && styles.disabled]}><Ionicons name={editing ? "checkmark" : "send"} size={17} color={colors.brandOn} /></Pressable></View>}
  </KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, live: { color: colors.brand, fontSize: 9, fontWeight: "900", marginTop: 3 }, list: { padding: spacing.lg, paddingBottom: spacing.xl }, message: { maxWidth: "86%", alignSelf: "flex-start", backgroundColor: colors.surface2, borderLeftWidth: 2, borderLeftColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.sm }, messageOwn: { alignSelf: "flex-end", borderLeftColor: colors.brand }, messageHead: { flexDirection: "row", gap: spacing.md, alignItems: "center" }, author: { color: colors.brand, fontSize: 11, fontWeight: "900" }, time: { color: colors.textDim, fontSize: 10 }, messageText: { color: colors.text, lineHeight: 20, marginTop: 5 }, composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }, input: { flex: 1, minHeight: 44, maxHeight: 110, paddingHorizontal: spacing.md, paddingVertical: 11, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, color: colors.text, backgroundColor: colors.bg }, send: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, disabled: { opacity: 0.4 }, error: { color: colors.error, paddingHorizontal: spacing.lg, paddingTop: spacing.sm }, empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }, emptyText: { color: colors.textMuted }, reactionRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 6 }, pill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bg }, pillMine: { borderColor: colors.brand }, pillText: { color: colors.text, fontSize: 11 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 7, paddingTop: 7, borderTopWidth: 1, borderTopColor: colors.border }, action: { minWidth: 32, height: 32, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.bg }, actionEmoji: { fontSize: 15 }, replyQuote: { borderLeftWidth: 2, borderLeftColor: colors.brand, paddingLeft: spacing.sm, marginBottom: 5 }, replyQuoteText: { color: colors.textDim, fontSize: 11, fontStyle: "italic" }, pinnedTag: { flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 4 }, pinnedText: { color: colors.brand, fontSize: 9, fontWeight: "900" }, pinsDrawer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, pinsItem: { color: colors.textMuted, fontSize: 12 }, contextBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface2 }, contextText: { flex: 1, color: colors.textMuted, fontSize: 12 }, readOnly: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }, readOnlyText: { color: colors.textDim, fontSize: 12 } });
