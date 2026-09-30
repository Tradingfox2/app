import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, mediaUrl, type DirectMessage, type MediaItem } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { ActionSheet } from "@/src/components/social/action-sheet";
import { MediaGrid } from "@/src/components/social/media";
import { ReportSheet, type ReportTarget } from "@/src/components/social/report-sheet";
import { useRealtimeUser } from "@/src/realtime";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const PAGE = 50;
/** How long a "typing…" nudge stays on screen without a fresh one. */
const TYPING_TTL_MS = 4000;
/** Throttle outgoing typing nudges to one every few seconds. */
const TYPING_EVERY_MS = 3000;

function httpStatus(cause: unknown): number | null {
  if (typeof cause === "object" && cause !== null && "status" in cause && typeof (cause as { status: unknown }).status === "number") {
    return (cause as { status: number }).status;
  }
  return null;
}

export default function DirectMessageScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>(); const router = useRouter(); const { user } = useAuth(); const { t, formatDate } = useI18n();
  const [messages, setMessages] = useState<DirectMessage[]>([]); const [draft, setDraft] = useState(""); const [sending, setSending] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [attachments, setAttachments] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [menuFor, setMenuFor] = useState<DirectMessage | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const revision = useRef(0); const sendingRef = useRef(false); const closedRef = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const load = useCallback(async () => {
    if (!id || sendingRef.current) return;
    const current = ++revision.current;
    try {
      const rows = await api.dmMessages(id);
      if (current !== revision.current) return;
      // Keep anything older the member already paged back through.
      setMessages(existing => {
        const fresh = new Set(rows.map(row => row.id));
        const older = existing.filter(row => !fresh.has(row.id) && rows.length && row.created_at < rows[0].created_at);
        return [...older, ...rows];
      });
      setHasOlder(previous => previous || rows.length === PAGE);
      setError("");
    }
    catch (cause) {
      if (current !== revision.current) return;
      if (httpStatus(cause) === 403) {
        // A block or a closed can_message must not leave history on screen,
        // and must not keep polling as if the thread were open.
        closedRef.current = true;
        setClosed(true);
        setMessages([]);
        setHasOlder(false);
      }
      setError(cause instanceof Error ? cause.message : t("Could not load messages"));
    }
    finally { if (current === revision.current) setLoading(false); }
  }, [id, t]);

  const { connected } = useRealtimeUser(!!user, event => {
    if (closedRef.current) return;
    if (event.type === "dm.created") {
      const message = event.message as DirectMessage;
      if (message.sender_id !== id) return;
      setPeerTyping(false);
      setMessages(rows => rows.some(row => row.id === message.id) ? rows : [...rows, message]);
      void load(); // marks it read, which sends the receipt back
    } else if (event.type === "dm.deleted") {
      setMessages(rows => rows.map(row => row.id === event.id ? { ...row, status: "deleted", content: "", media: [] } : row));
    } else if (event.type === "dm.read" && event.peer_id === id) {
      void load();
    } else if (event.type === "dm.typing" && event.peer_id === id) {
      setPeerTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setPeerTyping(false), TYPING_TTL_MS);
    }
  });

  useFocusEffect(useCallback(() => {
    closedRef.current = false; setClosed(false);
    sendingRef.current = false; setSending(false); setMessages([]); setDraft(""); setLoading(true); setError(""); void load();
    // With a live socket, a slow reconcile is enough; without one, poll.
    const timer = setInterval(() => { if (!closedRef.current) void load(); }, connected ? 45000 : 8000);
    return () => { clearInterval(timer); revision.current += 1; };
  }, [load, connected]));

  const older = async () => {
    if (!id || !messages.length) return;
    try {
      const rows = await api.dmMessages(id, messages[0].id);
      setMessages(current => [...rows.filter(row => !current.some(existing => existing.id === row.id)), ...current]);
      setHasOlder(rows.length === PAGE);
    } catch (cause) {
      if (httpStatus(cause) === 403) {
        closedRef.current = true;
        setClosed(true);
        setMessages([]);
        setHasOlder(false);
      }
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    }
  };

  const typed = (value: string) => {
    setDraft(value);
    if (!id || !value || Date.now() - lastTypingSent.current < TYPING_EVERY_MS) return;
    lastTypingSent.current = Date.now();
    api.dmTyping(id).catch(() => undefined);
  };

  const attach = async () => {
    if (uploading || attachments.length >= 4) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(t("Photo library access is needed to attach media.")); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const mime = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
      const uploaded = await api.uploadMedia({ uri: asset.uri, name: asset.fileName || `dm.${mime.split("/")[1]}`, mimeType: mime });
      setAttachments(items => [...items, uploaded]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { setUploading(false); }
  };

  const send = async () => {
    if (!id || (!draft.trim() && !attachments.length) || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setError("");
    const current = ++revision.current;
    try {
      const message = await api.sendDm(id, draft.trim(), attachments.map(item => item.id));
      if (current !== revision.current) return;
      setMessages(rows => [...rows.filter(row => row.id !== message.id), message]); setDraft(""); setAttachments([]);
    }
    catch (cause) { if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Could not send message")); }
    finally { if (current === revision.current) { sendingRef.current = false; setSending(false); } }
  };

  const unsend = async (message: DirectMessage) => {
    setMessages(rows => rows.map(row => row.id === message.id ? { ...row, status: "deleted", content: "", media: [] } : row));
    try { await api.deleteDm(message.id); } catch { void load(); }
  };

  // "Seen" belongs under the newest of my messages the other person has read.
  const lastSeenId = [...messages].reverse().find(row => row.sender_id === user?.id && row.read_at)?.id;
  const canSend = (!!draft.trim() || attachments.length > 0) && !sending && !loading && !uploading;

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior="padding" style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <Pressable accessibilityRole="button" onPress={() => id && router.push({ pathname: "/user/[id]", params: { id } })} style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{name || t("Direct message")}</Text>
        <Text style={styles.live} testID="dm-status">{peerTyping ? t("typing…") : t("PRIVATE")}</Text>
      </Pressable>
    </View>
    {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text></View> : null}
    {loading ? <ActivityIndicator color={colors.brand} /> : null}
    <FlatList data={messages} keyExtractor={item => item.id} contentContainerStyle={styles.list}
      ListHeaderComponent={hasOlder ? <Pressable accessibilityRole="button" testID="dm-older" onPress={() => void older()} style={styles.older}><Text style={styles.olderText}>{t("Load earlier messages")}</Text></Pressable> : null}
      ListEmptyComponent={!loading && !error && !closed ? <View style={styles.empty}><Ionicons name="lock-closed-outline" size={36} color={colors.textDim} /><Text style={styles.emptyText}>{t("Say hello. Only the two of you can read this.")}</Text></View> : null}
      renderItem={({ item }) => {
        const own = item.sender_id === user?.id;
        const deleted = item.status === "deleted";
        return <View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Message options")} onLongPress={() => !deleted && setMenuFor(item)} testID={`dm-${item.id}`} style={[styles.message, own && styles.messageOwn, deleted && styles.deleted]}>
            {deleted ? <Text style={styles.deletedText}>{t("Message deleted")}</Text> : <>
              {item.content ? <Text style={styles.messageText}>{item.content}</Text> : null}
              {item.media?.length ? <MediaGrid media={item.media} /> : null}
            </>}
            <View style={styles.meta}>
              <Text style={styles.time}>{formatDate(item.created_at, { hour: "2-digit", minute: "2-digit" })}</Text>
              {!deleted ? <Pressable accessibilityRole="button" accessibilityLabel={t("Message options")} testID={`dm-menu-${item.id}`} onPress={() => setMenuFor(item)}><Ionicons name="ellipsis-horizontal" size={12} color={colors.textDim} /></Pressable> : null}
            </View>
          </Pressable>
          {item.id === lastSeenId ? <Text style={styles.seen} testID="dm-seen">{t("Seen")}</Text> : null}
        </View>;
      }} />
    {!closed && attachments.length ? <View style={styles.pending}>{attachments.map(item => <View key={item.id}>
      {item.kind === "image" ? <Image source={{ uri: mediaUrl(item.url) }} style={styles.thumb} accessibilityIgnoresInvertColors /> : <View style={[styles.thumb, styles.videoThumb]}><Ionicons name="videocam" size={18} color={colors.brand} /></View>}
      <Pressable accessibilityRole="button" accessibilityLabel={t("Remove attachment")} onPress={() => setAttachments(items => items.filter(x => x.id !== item.id))} style={styles.removeThumb}><Ionicons name="close" size={10} color={colors.brandOn} /></Pressable>
    </View>)}</View> : null}
    {closed ? null : <View style={styles.composer} testID="dm-composer">
      <Pressable accessibilityRole="button" accessibilityLabel={t("Add photo or video")} testID="dm-attach" disabled={uploading || attachments.length >= 4} onPress={() => void attach()} style={[styles.attach, (uploading || attachments.length >= 4) && styles.disabled]}>
        {uploading ? <ActivityIndicator color={colors.brand} /> : <Ionicons name="image-outline" size={20} color={colors.brand} />}
      </Pressable>
      <TextInput value={draft} onChangeText={typed} editable={!sending} maxLength={4000} multiline placeholder={t("Message...")} placeholderTextColor={colors.textDim} style={styles.input} />
      <Pressable accessibilityRole="button" disabled={!canSend} onPress={() => void send()} accessibilityLabel={t("Send message")} style={[styles.send, !canSend && styles.disabled]}><Ionicons name="send" size={17} color={colors.brandOn} /></Pressable>
    </View>}
    <ActionSheet visible={!!menuFor} onClose={() => setMenuFor(null)} testID="dm-sheet" actions={menuFor ? (menuFor.sender_id === user?.id
      ? [{ key: "unsend", label: t("Unsend"), icon: "trash-outline", destructive: true, onPress: () => void unsend(menuFor) }]
      : [{ key: "report", label: t("Report message"), icon: "flag-outline", onPress: () => setReporting({ target_type: "direct_message", target_id: menuFor.id }) }]) : []} />
    <ReportSheet target={reporting} onClose={() => setReporting(null)} />
  </KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, live: { color: colors.brand, fontSize: 9, fontWeight: "900", marginTop: 3 }, list: { padding: spacing.lg, paddingBottom: spacing.xl }, older: { alignSelf: "center", padding: spacing.sm }, olderText: { color: colors.brand, fontWeight: "800", fontSize: 12 }, message: { maxWidth: "86%", alignSelf: "flex-start", backgroundColor: colors.surface2, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.xs }, messageOwn: { alignSelf: "flex-end", backgroundColor: colors.brandDim }, deleted: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border }, deletedText: { color: colors.textDim, fontStyle: "italic" }, messageText: { color: colors.text, lineHeight: 20 }, meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.sm }, time: { color: colors.textDim, fontSize: 10 }, seen: { color: colors.textDim, fontSize: 10, alignSelf: "flex-end", marginTop: -4, marginBottom: spacing.sm }, pending: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.surface }, thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surface2 }, videoThumb: { alignItems: "center", justifyContent: "center" }, removeThumb: { position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }, attach: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, input: { flex: 1, minHeight: 44, maxHeight: 110, paddingHorizontal: spacing.md, paddingVertical: 11, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, color: colors.text, backgroundColor: colors.bg }, send: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, disabled: { opacity: 0.4 }, error: { color: colors.error, paddingHorizontal: spacing.lg, paddingTop: spacing.sm }, empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }, emptyText: { color: colors.textMuted, textAlign: "center" } });
