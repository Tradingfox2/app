import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, mediaUrl, type CommunityChannel, type CommunityMessage, type MediaItem, type MentionedUser, type ProgramSnapshot } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { ADD_REACTION, ATTACH_MEDIA, DEFAULT_MEMBER, MANAGE_MESSAGES, PIN_MESSAGE, SEND_MESSAGE, can } from "@/src/permissions";
import { useRealtimeChannel } from "@/src/realtime";
import { activeQuery, applyMention } from "@/src/mentions";
import { FitnessPanel, ProgramCard } from "@/src/components/community/fitness-panel";
import { Avatar } from "@/src/components/social/avatar";
import { MediaGrid } from "@/src/components/social/media";
import { ReportSheet, type ReportTarget } from "@/src/components/social/report-sheet";
import { RichText } from "@/src/components/social/rich-text";
import { SAVE_LABEL } from "@/src/community-copy";

const QUICK_REACTIONS = ["💪", "🔥", "👏", "🎯", "😂"];
/** The full picker: training, food, recovery and the usual reactions. */
const ALL_REACTIONS = [
  "💪", "🔥", "👏", "🎯", "😂", "❤️", "👍", "👎", "🙌", "🤝", "💯", "⚡", "🏆", "🥇", "🥈", "🥉",
  "🏋️", "🏃", "🚴", "🧘", "🤸", "🥊", "⛹️", "🏊", "🍎", "🥗", "🍗", "🥤", "😴", "🧊", "😅", "😮",
  "😢", "🤔", "👀", "🙏", "✅", "❌", "🚀", "⭐",
];
const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Polling cadence with realtime down, and the slower reconcile when it is up. */
const POLL_MS = 8000;
const RECONCILE_MS = 45000;
const PAGE = 50;
const TYPING_TTL_MS = 4000;
const TYPING_EVERY_MS = 3000;

export default function ChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { user } = useAuth(); const { t, formatDate } = useI18n();
  const [messages, setMessages] = useState<CommunityMessage[]>([]); const [draft, setDraft] = useState(""); const [sending, setSending] = useState(false); const [error, setError] = useState("");
  const [channel, setChannel] = useState<CommunityChannel | null>(null);
  const [replyTo, setReplyTo] = useState<CommunityMessage | null>(null);
  const [editing, setEditing] = useState<CommunityMessage | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [serverPins, setServerPins] = useState<CommunityMessage[]>([]);
  const [roster, setRoster] = useState<MentionedUser[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [attachments, setAttachments] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommunityMessage[] | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const revision = useRef(0);
  const sendingRef = useRef(false);
  const lastTypingSent = useRef(0);
  const rosterFor = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelRefresh, setPanelRefresh] = useState(0);
  // Fall back to the baseline grant when the payload carries no mask, so an
  // older server never silently locks the composer. The API enforces regardless.
  const mask = channel?.permissions ?? DEFAULT_MEMBER;
  const readOnly = !!channel && !can(mask, SEND_MESSAGE);
  // Pins older than the loaded page come from the server; anything pinned on
  // this screen is merged in so the drawer is current without a refetch.
  const localPins = messages.filter(item => item.pinned_at);
  const pins = [...localPins, ...serverPins.filter(pin => !messages.some(item => item.id === pin.id))];

  const load = useCallback(async () => {
    if (!id || sendingRef.current) return;
    const requestRevision = ++revision.current;
    try {
      const [meta, rows] = await Promise.all([api.channel(id), api.channelMessages(id)]);
      if (requestRevision !== revision.current) return;
      setChannel(meta);
      // Keep older history the member already paged back through.
      setMessages(current => {
        if (!rows.length) return rows;
        const fresh = new Set(rows.map(row => row.id));
        const older = current.filter(row => !fresh.has(row.id) && row.created_at < rows[0].created_at);
        return [...older, ...rows];
      });
      setHasOlder(previous => previous || rows.length === PAGE);
      setError("");
      // Roster powers @ suggestions; a failure here must not break the channel.
      // Once per channel, not every poll: typed names are searched on demand.
      if (rosterFor.current !== meta.community_id) {
        rosterFor.current = meta.community_id;
        api.memberDirectory(meta.community_id).then(setRoster).catch(() => { rosterFor.current = null; });
      }
    } catch (cause) {
      if (requestRevision === revision.current) setError(cause instanceof Error ? cause.message : t("Could not load messages"));
    } finally {
      if (requestRevision === revision.current) setLoading(false);
    }
  }, [id, t]);

  const loadOlder = async () => {
    if (!id || !messages.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const rows = await api.channelMessages(id, messages[0].id);
      setMessages(current => [...rows.filter(row => !current.some(item => item.id === row.id)), ...current]);
      setHasOlder(rows.length === PAGE);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { setLoadingOlder(false); }
  };

  // Realtime is additive: a publication appends only what we do not already
  // have, so it can never duplicate or clobber an optimistic row.
  const { connected } = useRealtimeChannel(id ? `channel:${id}` : null, event => {
    if (event.type === "message.created") {
      const incoming = event.message as CommunityMessage | undefined;
      if (!incoming?.id || incoming.channel_id !== id) return;
      setTyping(current => { const next = { ...current }; delete next[incoming.author_id]; return next; });
      setMessages(current => current.some(item => item.id === incoming.id) ? current : [...current, incoming]);
      return;
    }
    if (event.type === "typing") {
      const who = event.user as { id: string; full_name: string | null } | undefined;
      if (!who || who.id === user?.id) return;
      setTyping(current => ({ ...current, [who.id]: { name: who.full_name || t("Someone"), until: Date.now() + TYPING_TTL_MS } }));
      return;
    }
    if (event.type === "live.started" || event.type === "live.ended") { setPanelRefresh(tick => tick + 1); void load(); return; }
    // Every other event mutates a row we already hold. It must never append:
    // an update for an unseen id belongs to history outside the loaded page.
    const targetId = typeof event.id === "string" ? event.id : null;
    if (!targetId) return;
    if (event.type === "message.deleted") {
      setMessages(current => current.filter(item => item.id !== targetId));
      return;
    }
    const changes: Partial<CommunityMessage> =
      event.type === "message.reactions" ? { reactions: event.reactions as CommunityMessage["reactions"] }
      : event.type === "message.updated" ? { content: event.content as string, edited_at: event.edited_at as string, mentions: event.mentions as CommunityMessage["mentions"] }
      : event.type === "message.pinned" ? { pinned_at: (event.pinned_at as string | null) ?? null }
      : {};
    if (!Object.keys(changes).length) return;
    setMessages(current => current.map(item => item.id === targetId ? { ...item, ...changes } : item));
  });

  // Expire "typing…" lines that were not refreshed.
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const timer = setInterval(() => setTyping(current => Object.fromEntries(Object.entries(current).filter(([, row]) => row.until > Date.now()))), 1000);
    return () => clearInterval(timer);
  }, [typing]);

  useFocusEffect(useCallback(() => {
    sendingRef.current = false; setSending(false);
    setMessages([]); setDraft(""); setLoading(true); setError(""); setReplyTo(null); setEditing(null); setActionsFor(null); setPinsOpen(false); setHasOlder(false); void load();
    if (id) api.channelPins(id).then(setServerPins).catch(() => setServerPins([]));
    return () => { revision.current += 1; };
  }, [load, id]));
  // Advance the read marker whenever the newest message on screen changes.
  // The server keeps it monotonic, so a stale call can never un-read anything.
  const newestId = messages[messages.length - 1]?.id;
  const lastMarked = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !newestId || lastMarked.current === newestId) return;
    lastMarked.current = newestId;
    api.markChannelRead(id, newestId).catch(() => { lastMarked.current = null; });
  }, [id, newestId]);
  // The timer never fully stops: with realtime up it drops to a slow reconcile,
  // so a missed publication cannot leave the channel permanently stale.
  useFocusEffect(useCallback(() => {
    const timer = setInterval(() => void load(), connected ? RECONCILE_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [load, connected]));

  // Search inside the channel, debounced.
  useEffect(() => {
    if (!searchOpen || !id || query.trim().length < 2) { setResults(null); return; }
    const timer = setTimeout(() => { api.searchChannel(id, query.trim()).then(setResults).catch(() => setResults([])); }, 300);
    return () => clearTimeout(timer);
  }, [query, searchOpen, id]);

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
    if (!id || (!draft.trim() && !attachments.length)) return;
    if (editing) {
      const updated = await api.editMessage(editing.id, draft.trim());
      setMessages(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
      setEditing(null);
    } else {
      const message = await api.createChannelMessage(id, draft.trim(), replyTo?.id ?? null, attachments.map(item => item.id));
      setMessages(current => [...current.filter(item => item.id !== message.id), message]);
      setReplyTo(null); setAttachments([]);
    }
    setDraft("");
  }, editing ? "Could not edit message" : "Could not send message");
  const react = (message: CommunityMessage, emoji: string) => mutate(async () => {
    const mine = message.reactions?.find(row => row.emoji === emoji)?.user_ids.includes(user?.id ?? "");
    const updated = mine ? await api.removeReaction(message.id, emoji) : await api.addReaction(message.id, emoji);
    setMessages(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    setActionsFor(null); setPickerFor(null);
  }, "Could not react");
  const togglePin = (message: CommunityMessage) => mutate(async () => {
    if (message.pinned_at) {
      await api.unpinMessage(message.id);
      setMessages(current => current.map(item => item.id === message.id ? { ...item, pinned_at: null } : item));
      setServerPins(current => current.filter(item => item.id !== message.id));
    }
    else { const updated = await api.pinMessage(message.id); setMessages(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item)); }
    setActionsFor(null);
  }, "Could not pin message");
  const remove = (message: CommunityMessage) => mutate(async () => {
    await api.deleteMessage(message.id);
    setMessages(current => current.filter(item => item.id !== message.id));
    setActionsFor(null);
  }, "Could not delete message");
  const startEdit = (message: CommunityMessage) => { setEditing(message); setReplyTo(null); setDraft(message.content); setActionsFor(null); };
  const canEdit = (message: CommunityMessage) => message.author_id === user?.id && !message.program && Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MS;
  const canDelete = (message: CommunityMessage) => message.author_id === user?.id || can(mask, MANAGE_MESSAGES);

  const typed = (value: string) => {
    setDraft(value);
    if (!id || !value || editing || Date.now() - lastTypingSent.current < TYPING_EVERY_MS) return;
    lastTypingSent.current = Date.now();
    api.channelTyping(id).catch(() => undefined);
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
      const uploaded = await api.uploadMedia({ uri: asset.uri, name: asset.fileName || `chat.${mime.split("/")[1]}`, mimeType: mime });
      setAttachments(items => [...items, uploaded]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { setUploading(false); }
  };

  // Suggestions open only while the caret sits in an unbroken run after "@",
  // so an email address in a message never pops the picker.
  const mentionQuery = readOnly ? null : activeQuery(draft);
  const suggestions = mentionQuery === null ? [] : roster
    .filter(candidate => candidate.id !== user?.id)
    .filter(candidate => (candidate.full_name ?? "").toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 5);
  const pickMention = (candidate: MentionedUser) => setDraft(current => applyMention(current, candidate));
  // Large communities: the first page of the directory will not hold every
  // name, so a typed "@da" asks the server and merges what it finds.
  const communityId = channel?.community_id;
  useEffect(() => {
    if (!communityId || mentionQuery === null || mentionQuery.length < 2) return;
    const timer = setTimeout(() => {
      api.memberDirectory(communityId, mentionQuery)
        .then(found => setRoster(current => [...current, ...found.filter(person => !current.some(known => known.id === person.id))]))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [communityId, mentionQuery]);
  const typingNames = Object.values(typing).map(row => row.name);

  const renderMessage = ({ item }: { item: CommunityMessage }) => {
    const own = item.author_id === user?.id;
    const open = actionsFor === item.id;
    return <View style={[styles.message, own && styles.messageOwn]} testID={`message-${item.id}`}>
      {item.pinned_at ? <View style={styles.pinnedTag}><Ionicons name="pin" size={10} color={colors.text} /><Text style={styles.pinnedText}>{t("PINNED")}</Text></View> : null}
      {item.reply_to ? <View style={styles.replyQuote}><Text numberOfLines={1} style={styles.replyQuoteText}>{item.reply_to.author?.full_name ? `${item.reply_to.author.full_name}: ` : ""}{item.reply_to.content}</Text></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t("Message actions")} testID={`message-actions-${item.id}`} onLongPress={() => setActionsFor(open ? null : item.id)} delayLongPress={250}>
        <View style={styles.messageHead}>
          <Pressable accessibilityRole="button" accessibilityLabel={item.author?.full_name || t("Member")} onPress={() => router.push({ pathname: "/user/[id]", params: { id: item.author_id } })}><Avatar user={item.author} size={20} /></Pressable>
          <Text style={styles.author}>{own ? t("You") : item.author?.full_name || t("Member")}</Text>
          {item.author_role ? <Text style={[styles.roleTag, { color: item.author_role.color || colors.text, borderColor: item.author_role.color || colors.text }]} testID={`role-${item.id}`}>{item.author_role.name === "owner" || item.author_role.name === "moderator" ? t(item.author_role.name.toUpperCase()) : item.author_role.name}</Text> : null}
          <Text style={styles.time}>{formatDate(item.created_at, { hour: "2-digit", minute: "2-digit" })}</Text>{item.edited_at ? <Text style={styles.time}>{t("edited")}</Text> : null}
        </View>
        {item.content ? <RichText content={item.content} mentions={item.mentions ?? []} style={styles.messageText} /> : null}
      </Pressable>
      {item.media?.length ? <View style={{ marginTop: 6 }}><MediaGrid media={item.media} /></View> : null}
      {item.program ? <ProgramCard message={item as CommunityMessage & { program: ProgramSnapshot }} /> : null}
      {item.live_session_id ? <View style={styles.liveTag}><Ionicons name="radio" size={12} color={colors.text} /><Text style={styles.pinnedText}>{t("SESSION SCHEDULED — SEE ABOVE")}</Text></View> : null}
      {item.reactions?.length ? <View style={styles.reactionRow}>{item.reactions.map(row => {
        const mine = row.user_ids.includes(user?.id ?? "");
        return <Pressable key={row.emoji} accessibilityRole="button" testID={`reaction-${item.id}-${row.emoji}`} disabled={!can(mask, ADD_REACTION)} onPress={() => react(item, row.emoji)} style={[styles.pill, mine && styles.pillMine]}><Text style={styles.pillText}>{row.emoji} {row.user_ids.length}</Text></Pressable>;
      })}</View> : null}
      {open ? <View style={styles.actions} testID={`actions-${item.id}`}>
        {can(mask, ADD_REACTION) ? QUICK_REACTIONS.map(emoji => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`${t("React")} ${emoji}`} testID={`react-${item.id}-${emoji}`} onPress={() => react(item, emoji)} style={styles.action}><Text style={styles.actionEmoji}>{emoji}</Text></Pressable>) : null}
        {can(mask, ADD_REACTION) ? <Pressable accessibilityRole="button" accessibilityLabel={t("More reactions")} testID={`react-more-${item.id}`} onPress={() => setPickerFor(pickerFor === item.id ? null : item.id)} style={styles.action}><Ionicons name="happy-outline" size={15} color={colors.text} /></Pressable> : null}
        {can(mask, SEND_MESSAGE) ? <Pressable accessibilityRole="button" testID={`reply-${item.id}`} onPress={() => { setReplyTo(item); setEditing(null); setActionsFor(null); }} style={styles.action}><Ionicons name="return-down-back" size={15} color={colors.text} /></Pressable> : null}
        {can(mask, PIN_MESSAGE) ? <Pressable accessibilityRole="button" testID={`pin-${item.id}`} onPress={() => togglePin(item)} style={styles.action}><Ionicons name={item.pinned_at ? "pin-outline" : "pin"} size={15} color={colors.text} /></Pressable> : null}
        {canEdit(item) ? <Pressable accessibilityRole="button" testID={`edit-${item.id}`} onPress={() => startEdit(item)} style={styles.action}><Ionicons name="pencil" size={15} color={colors.text} /></Pressable> : null}
        {canDelete(item) ? <Pressable accessibilityRole="button" testID={`delete-${item.id}`} onPress={() => remove(item)} style={styles.action}><Ionicons name="trash-outline" size={15} color={colors.error} /></Pressable> : null}
        {!own ? <Pressable accessibilityRole="button" accessibilityLabel={t("Report message")} testID={`report-${item.id}`} onPress={() => { setActionsFor(null); setReporting({ target_type: "message", target_id: item.id }); }} style={styles.action}><Ionicons name="flag-outline" size={15} color={colors.text} /></Pressable> : null}
      </View> : null}
      {open && pickerFor === item.id ? <View style={styles.picker} testID={`emoji-picker-${item.id}`}>{ALL_REACTIONS.map(emoji => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`${t("React")} ${emoji}`} onPress={() => react(item, emoji)} style={styles.pickerCell}><Text style={styles.actionEmoji}>{emoji}</Text></Pressable>)}</View> : null}
    </View>;
  };

  const kindLabel = channel?.kind && channel.kind !== "text" ? t(channel.kind.toUpperCase()) : t("MEMBER CHAT");
  const slowmode = channel?.slowmode_sec ? ` · ${t("SLOW MODE {n}s").replace("{n}", String(channel.slowmode_sec))}` : "";
  const canSend = (!!draft.trim() || attachments.length > 0) && !sending && !loading && !uploading;

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior="padding" style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <View style={{ flex: 1 }}><Text style={styles.headerTitle}># {channel?.name || t("CHANNEL")}</Text><Text style={styles.live}>{kindLabel}{slowmode}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Search this channel")} testID="toggle-search" onPress={() => { setSearchOpen(open => !open); setQuery(""); }} style={styles.icon}><Ionicons name="search" size={18} color={searchOpen ? colors.text : colors.text} /></Pressable>
      {pins.length ? <Pressable accessibilityRole="button" testID="toggle-pins" onPress={() => setPinsOpen(open => !open)} style={styles.icon}><Ionicons name="pin" size={18} color={pinsOpen ? colors.text : colors.text} /></Pressable> : null}
    </View>
    {channel?.description ? <Text style={styles.topic} numberOfLines={2}>{channel.description}</Text> : null}
    {searchOpen ? <View style={styles.searchBox} testID="channel-search">
      <TextInput autoFocus value={query} onChangeText={setQuery} maxLength={80} placeholder={t("Search messages")} placeholderTextColor={colors.textDim} style={styles.input} testID="channel-search-input" />
      {results ? results.length === 0 ? <Text style={styles.readOnlyText}>{t("No messages match.")}</Text> : results.map(row => <View key={row.id} style={styles.searchRow} testID={`search-hit-${row.id}`}>
        <Text style={styles.author}>{row.author?.full_name || t("Member")} · {formatDate(row.created_at, { day: "numeric", month: "short" })}</Text>
        <RichText content={row.content} mentions={row.mentions ?? []} style={styles.pinsItem} numberOfLines={2} />
      </View>) : null}
    </View> : null}
    {pinsOpen && pins.length ? <View style={styles.pinsDrawer} testID="pins-drawer">{pins.map(item => <View key={item.id} style={styles.pinRow}>
      <Text numberOfLines={1} style={[styles.pinsItem, { flex: 1 }]}>{item.author?.full_name ? `${item.author.full_name}: ` : ""}{item.content}</Text>
      {can(mask, PIN_MESSAGE) ? <Pressable accessibilityRole="button" accessibilityLabel={t("Unpin")} testID={`unpin-${item.id}`} onPress={() => togglePin(item)}><Ionicons name="close" size={14} color={colors.textDim} /></Pressable> : null}
    </View>)}</View> : null}
    {id && channel?.kind ? <FitnessPanel channelId={id} kind={channel.kind} refreshKey={messages.length + panelRefresh} mask={mask} userId={user?.id} /> : null}
    {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.icon}><Text style={styles.author}>{t("Retry")}</Text></Pressable></View> : null}
    {loading ? <ActivityIndicator accessibilityLabel={t("Loading...")} color={colors.text} /> : null}
    <FlatList data={messages} keyExtractor={item => item.id} contentContainerStyle={styles.list}
      ListHeaderComponent={hasOlder ? <Pressable accessibilityRole="button" testID="load-older" disabled={loadingOlder} onPress={() => void loadOlder()} style={styles.older}>
        {loadingOlder ? <ActivityIndicator color={colors.text} /> : <Text style={styles.olderText}>{t("Load earlier messages")}</Text>}
      </Pressable> : null}
      ListEmptyComponent={!loading && !error ? <View style={styles.empty}><Ionicons name="chatbubbles-outline" size={36} color={colors.textDim} /><Text style={styles.emptyText}>{t("Start the conversation")}</Text></View> : null} renderItem={renderMessage} />
    {typingNames.length ? <Text style={styles.typing} testID="typing-indicator">{typingNames.length === 1 ? t("{name} is typing…").replace("{name}", typingNames[0]) : t("Several people are typing…")}</Text> : null}
    {replyTo ? <View style={styles.contextBar} testID="reply-bar"><Ionicons name="return-down-back" size={14} color={colors.text} /><Text numberOfLines={1} style={styles.contextText}>{replyTo.content}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Cancel")} testID="cancel-reply" onPress={() => setReplyTo(null)}><Ionicons name="close" size={16} color={colors.textDim} /></Pressable></View> : null}
    {editing ? <View style={styles.contextBar} testID="edit-bar"><Ionicons name="pencil" size={14} color={colors.text} /><Text numberOfLines={1} style={styles.contextText}>{t("Editing message")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Cancel")} testID="cancel-edit" onPress={() => { setEditing(null); setDraft(""); }}><Ionicons name="close" size={16} color={colors.textDim} /></Pressable></View> : null}
    {suggestions.length ? <View style={styles.suggestions} testID="mention-suggestions">
      {suggestions.map(candidate => <Pressable key={candidate.id} accessibilityRole="button" testID={`mention-${candidate.id}`} onPress={() => pickMention(candidate)} style={styles.suggestion}>
        <Ionicons name="at" size={13} color={colors.text} />
        <Text style={styles.suggestionText}>{candidate.full_name || t("Member")}</Text>
      </Pressable>)}
    </View> : null}
    {attachments.length ? <View style={styles.pending}>{attachments.map(item => <View key={item.id}>
      {item.kind === "image" ? <Image source={{ uri: mediaUrl(item.url) }} style={styles.thumb} accessibilityIgnoresInvertColors /> : <View style={[styles.thumb, styles.videoThumb]}><Ionicons name="videocam" size={18} color={colors.text} /></View>}
      <Pressable accessibilityRole="button" accessibilityLabel={t("Remove attachment")} onPress={() => setAttachments(items => items.filter(x => x.id !== item.id))} style={styles.removeThumb}><Ionicons name="close" size={10} color={colors.text} /></Pressable>
    </View>)}</View> : null}
    {readOnly
      ? <View style={styles.readOnly} testID="composer-read-only"><Ionicons name="lock-closed-outline" size={14} color={colors.textDim} /><Text style={styles.readOnlyText}>{t("Only channel managers can post here.")}</Text></View>
      : <View style={styles.composer}>
        {can(mask, ATTACH_MEDIA) && !editing ? <Pressable accessibilityRole="button" accessibilityLabel={t("Add photo or video")} testID="composer-attach" disabled={uploading || attachments.length >= 4} onPress={() => void attach()} style={[styles.attach, (uploading || attachments.length >= 4) && styles.disabled]}>
          {uploading ? <ActivityIndicator color={colors.text} /> : <Ionicons name="image-outline" size={20} color={colors.text} />}
        </Pressable> : null}
        <TextInput value={draft} onChangeText={typed} editable={!sending} maxLength={4000} multiline placeholder={t("Message the channel...")} placeholderTextColor={colors.textDim} style={styles.input} testID="composer-input" />
        <Pressable accessibilityRole="button" disabled={!canSend} onPress={send} accessibilityLabel={editing ? t(SAVE_LABEL) : t("Send message")} accessibilityHint={editing ? t("Confirm the edited message") : t("Send this message")} {...(Platform.OS === "web" ? { title: editing ? t(SAVE_LABEL) : t("Send message") } : {})} testID="composer-send" style={[styles.send, !canSend && styles.disabled]}><Ionicons name={editing ? "checkmark" : "send"} size={17} color={colors.brandOn} /></Pressable>
      </View>}
    <ReportSheet target={reporting} onClose={() => setReporting(null)} />
  </KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, live: { color: colors.text, fontSize: 9, fontWeight: "900", marginTop: 3 }, topic: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border }, list: { padding: spacing.lg, paddingBottom: spacing.xl }, older: { alignSelf: "center", padding: spacing.sm, marginBottom: spacing.sm }, olderText: { color: colors.text, fontWeight: "800", fontSize: 12 }, message: { maxWidth: "86%", alignSelf: "flex-start", backgroundColor: colors.surface2, borderLeftWidth: 2, borderLeftColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.sm }, messageOwn: { alignSelf: "flex-end", borderLeftColor: colors.text }, messageHead: { flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }, author: { color: colors.text, fontSize: 11, fontWeight: "900" }, roleTag: { fontSize: 9, fontWeight: "900", borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 4, textTransform: "uppercase" }, time: { color: colors.textDim, fontSize: 10 }, messageText: { color: colors.text, lineHeight: 20, marginTop: 5 }, composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }, attach: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, input: { flex: 1, minHeight: 44, maxHeight: 110, paddingHorizontal: spacing.md, paddingVertical: 11, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, color: colors.text, backgroundColor: colors.bg }, send: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, disabled: { opacity: 0.4 }, error: { color: colors.error, paddingHorizontal: spacing.lg, paddingTop: spacing.sm }, empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }, emptyText: { color: colors.textMuted }, reactionRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 6 }, pill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bg }, pillMine: { borderColor: colors.text }, pillText: { color: colors.text, fontSize: 11 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 7, paddingTop: 7, borderTopWidth: 1, borderTopColor: colors.border }, action: { minWidth: 32, height: 32, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.bg }, actionEmoji: { fontSize: 15 }, picker: { flexDirection: "row", flexWrap: "wrap", gap: 2, marginTop: 6 }, pickerCell: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.bg }, replyQuote: { borderLeftWidth: 2, borderLeftColor: colors.text, paddingLeft: spacing.sm, marginBottom: 5 }, replyQuoteText: { color: colors.textDim, fontSize: 11, fontStyle: "italic" }, pinnedTag: { flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 4 }, pinnedText: { color: colors.text, fontSize: 9, fontWeight: "900" }, liveTag: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }, pinsDrawer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, pinRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, pinsItem: { color: colors.textMuted, fontSize: 12 }, searchBox: { padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, searchRow: { gap: 2, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }, contextBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface2 }, contextText: { flex: 1, color: colors.textMuted, fontSize: 12 }, typing: { color: colors.textDim, fontSize: 11, fontStyle: "italic", paddingHorizontal: spacing.lg, paddingBottom: 4 }, pending: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.surface }, thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surface2 }, videoThumb: { alignItems: "center", justifyContent: "center" }, removeThumb: { position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }, readOnly: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }, readOnlyText: { color: colors.textDim, fontSize: 12 }, suggestions: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface2, paddingVertical: 4 }, suggestion: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg }, suggestionText: { color: colors.text, fontSize: 13 } });
