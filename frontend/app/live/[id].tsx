import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, type LiveChatMessage, type LiveParticipant, type LiveSession } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { MANAGE_CHANNEL, START_LIVE_SESSION, can } from "@/src/permissions";
import { useRealtimeChannel, type RealtimeEvent } from "@/src/realtime";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

/** Reconcile quickly when the socket is down; slowly when Centrifugo is delivering. */
const POLL_MS = 3000;
const RECONCILE_MS = 30000;

/**
 * The only live screen. `app/+native-intent.ts` rewrites `ironflow://live/{id}`
 * onto `/live/[id]`, and this room is what that route renders: persisted join,
 * presence, and session chat on Centrifugo `live:{id}`.
 *
 * A thin GET landing (status, RSVP, external link only) is superseded.
 * The app does not stream video; an optional external join_url stays a link.
 */
function sessionId(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw || undefined;
}

export default function LiveRoomScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = sessionId(params.id);
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [joined, setJoined] = useState(false);
  const [mask, setMask] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const sendingRef = useRef(false);

  const applyRoom = (room: { session: LiveSession; participants: LiveParticipant[]; joined: boolean }) => {
    setSession(room.session);
    setParticipants(room.participants);
    setJoined(room.joined);
  };

  const load = useCallback(async () => {
    if (!id || sendingRef.current) return;
    const requestRevision = ++revision.current;
    try {
      let room = await api.liveSession(id);
      if (requestRevision !== revision.current) return;
      // Ask for the Centrifugo subscription even when the socket is down, so
      // the room is tied to `live:{id}` and not a local viewer list.
      const roomChannel = room.realtime_channel || `live:${id}`;
      void api.realtimeSubscriptionToken(roomChannel).catch(() => undefined);
      let joinFailed = false;
      if (room.session.status === "live" && !room.joined) {
        try {
          room = await api.joinLive(id);
        } catch (cause) {
          if (requestRevision !== revision.current) return;
          joinFailed = true;
          setError(cause instanceof Error ? cause.message : t("Could not join the session"));
          room = await api.liveSession(id);
        }
      }
      if (requestRevision !== revision.current) return;
      applyRoom(room);
      const rows = await api.liveMessages(id);
      if (requestRevision !== revision.current) return;
      setMessages(current => {
        const known = new Set(rows.map(row => row.id));
        const pending = current.filter(row => !known.has(row.id));
        return [...rows, ...pending];
      });
      if (room.session.channel_id) {
        api.channel(room.session.channel_id).then(channel => {
          if (requestRevision === revision.current) setMask(channel.permissions ?? 0);
        }).catch(() => undefined);
      }
      if (!joinFailed) setError("");
    } catch (cause) {
      if (requestRevision === revision.current) setError(cause instanceof Error ? cause.message : t("Could not join the session"));
    } finally {
      if (requestRevision === revision.current) setLoading(false);
    }
  }, [id, t]);

  const onEvent = useCallback((event: RealtimeEvent) => {
    if (event.type === "presence.joined") {
      const person = event.user as LiveParticipant["user"] | undefined;
      const userId = typeof event.user_id === "string" ? event.user_id : person?.id;
      if (!userId) return;
      setParticipants(current => current.some(row => row.user_id === userId) ? current : [
        ...current,
        { user_id: userId, joined_at: new Date().toISOString(), user: person ?? null },
      ]);
      return;
    }
    if (event.type === "chat.message") {
      const message = event.message as LiveChatMessage | undefined;
      if (!message?.id) return;
      setMessages(current => current.some(row => row.id === message.id) ? current : [...current, message]);
      return;
    }
    if (event.type === "live.ended") {
      setSession(current => current ? { ...current, status: "ended", ended_at: new Date().toISOString() } : current);
      return;
    }
    if (event.type === "live.started") void load();
  }, [load]);

  const channelName = id ? `live:${id}` : null;
  const { connected } = useRealtimeChannel(channelName, onEvent);

  useFocusEffect(useCallback(() => {
    sendingRef.current = false;
    setSending(false);
    setLoading(true);
    void load();
    const timer = setInterval(() => void load(), connected ? RECONCILE_MS : POLL_MS);
    return () => { clearInterval(timer); revision.current += 1; };
  }, [load, connected]));

  const send = async () => {
    if (!id || sending || !draft.trim() || session?.status !== "live" || !joined) return;
    const content = draft.trim();
    sendingRef.current = true;
    setSending(true);
    setDraft("");
    try {
      const message = await api.sendLiveMessage(id, content);
      setMessages(current => current.some(row => row.id === message.id) ? current : [...current, message]);
      setError("");
    } catch (cause) {
      setDraft(content);
      setError(cause instanceof Error ? cause.message : t("Could not send message"));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const end = async () => {
    if (!id) return;
    setError("");
    try {
      await api.endLive(id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    }
  };

  const live = session?.status === "live";
  const ended = session?.status === "ended" || session?.status === "cancelled";
  const hosting = !!session && session.host_id === user?.id;
  const canEnd = hosting || (can(mask, START_LIVE_SESSION) && can(mask, MANAGE_CHANNEL));
  const back = () => {
    if (router.canGoBack()) router.back();
    else if (session) router.replace({ pathname: "/channel/[id]", params: { id: session.channel_id } });
    else router.replace("/(tabs)/community");
  };

  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView behavior="padding" style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Back")} onPress={back} style={styles.icon} testID="live-room-back">
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1} testID="live-room-title">{session?.title || t("LIVE ROOM")}</Text>
          <Text style={styles.meta}>{t("{count} here").replace("{count}", String(participants.length))}</Text>
        </View>
        {live ? <View style={styles.badge} testID="live-room-badge"><Text style={styles.badgeText}>{t("LIVE")}</Text></View> : null}
        {canEnd && live ? <Pressable accessibilityRole="button" onPress={() => void end()} style={styles.end} testID="live-room-end"><Text style={styles.endText}>{t("END")}</Text></Pressable> : null}
      </View>

      <View style={styles.room} testID="live-room">
        {loading && !session ? <ActivityIndicator color={colors.brand} /> : null}
        {session && !live && !ended ? <Text style={styles.notice} testID="live-room-waiting">{t("Waiting for the coach to go live.")}</Text> : null}
        {ended ? <Text style={styles.notice} testID="live-room-ended">{t("This session has ended.")} {t("You can still read the chat.")}</Text> : null}
        {error ? <Text style={styles.error} testID="live-room-error">{error}</Text> : null}

        <Text style={styles.section}>{t("IN THE ROOM")}</Text>
        <View style={styles.presence} testID="live-presence">
          {participants.length === 0 ? <Text style={styles.meta}>{t("No one else is here yet.")}</Text> : participants.map(person => (
            <View key={person.user_id} style={styles.person} testID={`live-presence-${person.user_id}`}>
              <Ionicons name="person" size={14} color={colors.brand} />
              <Text style={styles.personName}>{person.user?.full_name || t("Someone")}</Text>
            </View>
          ))}
        </View>

        <FlatList
          data={messages}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.messages}
          ListEmptyComponent={!loading && live ? <Text style={styles.meta}>{t("Say something to the room")}</Text> : null}
          renderItem={({ item }) => (
            <View style={styles.message} testID={`live-chat-${item.id}`}>
              <Text style={styles.personName}>{item.author?.full_name || t("Someone")}</Text>
              <Text style={styles.messageText}>{item.content}</Text>
            </View>
          )}
        />

        {session?.join_url ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(session.join_url!)} style={styles.external} testID="live-room-external">
          <Text style={styles.externalText}>{t("OPEN LINK")}</Text>
        </Pressable> : null}

        {live && joined ? <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            editable={!sending}
            maxLength={2000}
            placeholder={t("Say something to the room")}
            placeholderTextColor={colors.textDim}
            style={styles.input}
            testID="live-composer"
          />
          <Pressable accessibilityRole="button" accessibilityLabel={t("Send message")} disabled={!draft.trim() || sending} onPress={() => void send()} style={[styles.send, (!draft.trim() || sending) && styles.disabled]} testID="live-send">
            <Ionicons name="send" size={16} color={colors.brandOn} />
          </Pressable>
        </View> : null}
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  icon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontWeight: "900", fontSize: 16 },
  meta: { color: colors.textMuted, fontSize: 12 },
  badge: { backgroundColor: colors.error, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  end: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  endText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  room: { flex: 1, paddingHorizontal: spacing.md, gap: spacing.sm },
  notice: { color: colors.text, fontSize: 14, fontWeight: "700" },
  error: { color: colors.error, fontSize: 13 },
  section: { color: colors.textMuted, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  presence: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  person: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  personName: { color: colors.text, fontSize: 12, fontWeight: "800" },
  messages: { gap: spacing.sm, paddingBottom: spacing.md },
  message: { gap: 2 },
  messageText: { color: colors.text, fontSize: 15 },
  external: { alignSelf: "flex-start", minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  externalText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  composer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.md },
  input: { flex: 1, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, color: colors.text },
  send: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.5 },
});
