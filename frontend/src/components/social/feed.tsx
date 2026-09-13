import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { api, mediaUrl, MediaItem, Post, PostComment } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

type Scope = "all" | "following" | "mine";

export function useFeed() {
  const { t } = useI18n();
  const [scope, setScope] = useState<Scope>("all");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);

  const load = useCallback(async (nextScope: Scope = scope) => {
    const current = ++revision.current;
    setError("");
    try {
      const rows = await api.feed(nextScope);
      if (current !== revision.current) return;
      setPosts(rows);
    } catch {
      if (current === revision.current) setError(t("Something went wrong"));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [scope, t]);

  const changeScope = (next: Scope) => { setScope(next); setLoading(true); void load(next); };
  const patch = (id: string, updater: (post: Post) => Post) => setPosts(rows => rows.map(row => row.id === id ? updater(row) : row));
  const prepend = (post: Post) => setPosts(rows => [post, ...rows.filter(row => row.id !== post.id)]);
  const remove = (id: string) => setPosts(rows => rows.filter(row => row.id !== id));
  const stop = () => { revision.current += 1; };
  return { scope, changeScope, posts, loading, error, load, patch, prepend, remove, stop };
}

export function Composer({ onPublished }: { onPublished: (post: Post) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState<"upload" | "publish" | null>(null);
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  const pick = async () => {
    if (busyRef.current || media.length >= 4) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(t("Photo library access is needed to attach media.")); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.85, allowsMultipleSelection: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    busyRef.current = true; setBusy("upload"); setError("");
    try {
      const mime = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
      const uploaded = await api.uploadMedia({ uri: asset.uri, name: asset.fileName || `upload.${mime.split("/")[1]}`, mimeType: mime });
      setMedia(items => [...items, uploaded]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { busyRef.current = false; setBusy(null); }
  };

  const publish = async () => {
    if (busyRef.current || (!text.trim() && media.length === 0)) return;
    busyRef.current = true; setBusy("publish"); setError("");
    try {
      const post = await api.publish({ content: text.trim(), media_ids: media.map(item => item.id) });
      setText(""); setMedia([]); onPublished(post);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { busyRef.current = false; setBusy(null); }
  };

  const canPublish = !busy && (text.trim().length > 0 || media.length > 0);
  return (
    <View style={styles.composer} testID="feed-composer">
      <TextInput value={text} onChangeText={setText} multiline maxLength={4000} editable={!busy} placeholder={t("Share a PR, a session, a progress photo...")} placeholderTextColor={colors.textDim} style={styles.input} />
      {media.length ? <View style={styles.thumbs}>{media.map(item => <View key={item.id} style={styles.thumbWrap}>{item.kind === "image" ? <Image source={{ uri: mediaUrl(item.url) }} style={styles.thumb} accessibilityIgnoresInvertColors /> : <View style={[styles.thumb, styles.videoThumb]}><Ionicons name="videocam" size={22} color={colors.brand} /></View>}<Pressable accessibilityRole="button" accessibilityLabel={t("Remove attachment")} onPress={() => setMedia(items => items.filter(x => x.id !== item.id))} style={styles.removeThumb}><Ionicons name="close" size={12} color={colors.brandOn} /></Pressable></View>)}</View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.composerRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Add photo or video")} disabled={!!busy || media.length >= 4} onPress={() => void pick()} style={[styles.iconButton, (!!busy || media.length >= 4) && styles.disabled]}>
          {busy === "upload" ? <ActivityIndicator color={colors.brand} /> : <Ionicons name="image-outline" size={20} color={colors.brand} />}
        </Pressable>
        <Text style={styles.counter}>{text.length ? `${text.length}/4000` : ""}</Text>
        <Pressable accessibilityRole="button" testID="feed-publish" disabled={!canPublish} onPress={() => void publish()} style={[styles.publish, !canPublish && styles.disabled]}>
          {busy === "publish" ? <ActivityIndicator color={colors.brandOn} /> : <Text style={styles.publishText}>{t("POST")}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

export function PostCard({ post, onChange, onRemoved, onReposted }: { post: Post; onChange: (next: Post) => void; onRemoved: () => void; onReposted: (post: Post) => void }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const shown = post.original && !post.original.unavailable ? post.original : post;

  const guard = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); } catch { /* server state is authoritative; UI already reflects last known state */ }
    finally { busyRef.current = false; setBusy(false); }
  };
  const toggleLike = () => guard(async () => {
    const result = post.liked_by_me ? await api.unlikePost(post.id) : await api.likePost(post.id);
    onChange({ ...post, liked_by_me: result.liked, like_count: result.like_count });
  });
  const share = () => guard(async () => {
    if (post.reposted_by_me) return;
    const created = await api.repost(post.id);
    onChange({ ...post, reposted_by_me: true, repost_count: post.repost_count + 1 });
    onReposted(created);
  });
  const toggleComments = () => guard(async () => {
    if (comments) { setComments(null); return; }
    setComments(await api.comments(post.id));
  });
  const sendComment = () => guard(async () => {
    if (!draft.trim()) return;
    const created = await api.addComment(post.id, draft.trim());
    setComments(rows => [...(rows || []), created]); setDraft("");
    onChange({ ...post, comment_count: post.comment_count + 1 });
  });
  const remove = () => guard(async () => { await api.deletePost(post.id); onRemoved(); });
  const [reported, setReported] = useState(false);
  const report = () => guard(async () => {
    await api.report({ target_type: "post", target_id: shown.id, reason: "other" });
    setReported(true);
  });

  return (
    <View style={styles.card} testID={`post-${post.id}`}>
      {post.repost_of ? <Text style={styles.repostLabel}><Ionicons name="repeat" size={12} color={colors.textMuted} /> {t("{name} reposted", { name: post.author?.full_name || t("Member") })}</Text> : null}
      <View style={styles.head}>
        <Pressable accessibilityRole="button" onPress={() => shown.author && router.push({ pathname: "/user/[id]", params: { id: shown.author.id } })} style={styles.avatar}><Text style={styles.avatarText}>{(shown.author?.full_name || "?").charAt(0).toUpperCase()}</Text></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.author}>{shown.author?.full_name || t("Member")}</Text>
          <Text style={styles.time}>{formatDate(shown.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
        </View>
        {post.author_id === user?.id ? <Pressable accessibilityRole="button" accessibilityLabel={t("Delete post")} disabled={busy} onPress={() => void remove()} style={styles.iconButton}><Ionicons name="trash-outline" size={18} color={colors.textDim} /></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={t(reported ? "Reported" : "Report post")} disabled={busy || reported} onPress={() => void report()} style={styles.iconButton}><Ionicons name={reported ? "flag" : "flag-outline"} size={17} color={reported ? colors.brand : colors.textDim} /></Pressable>}
      </View>
      {post.original?.unavailable ? <Text style={styles.unavailable}>{t("This post is no longer available.")}</Text> : null}
      {shown.content ? <Text style={styles.content}>{shown.content}</Text> : null}
      {shown.media?.length ? <View style={styles.mediaGrid}>{shown.media.map(item => item.kind === "image" ? <Image key={item.id} source={{ uri: mediaUrl(item.url) }} style={[styles.media, shown.media.length === 1 && styles.mediaSingle]} accessibilityIgnoresInvertColors /> : <View key={item.id} style={[styles.media, styles.videoThumb, shown.media.length === 1 && styles.mediaSingle]}><Ionicons name="play-circle" size={44} color={colors.brand} /><Text style={styles.videoLabel}>{t("VIDEO")}</Text></View>)}</View> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={post.liked_by_me ? t("Unlike") : t("Like")} accessibilityState={{ selected: post.liked_by_me }} disabled={busy} onPress={() => void toggleLike()} style={styles.action}><Ionicons name={post.liked_by_me ? "heart" : "heart-outline"} size={20} color={post.liked_by_me ? colors.brand : colors.textMuted} /><Text style={[styles.actionText, post.liked_by_me && styles.actionActive]}>{formatNumber(post.like_count)}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Comments")} disabled={busy} onPress={() => void toggleComments()} style={styles.action}><Ionicons name="chatbubble-outline" size={19} color={colors.textMuted} /><Text style={styles.actionText}>{formatNumber(post.comment_count)}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Repost")} accessibilityState={{ selected: post.reposted_by_me }} disabled={busy || post.reposted_by_me} onPress={() => void share()} style={styles.action}><Ionicons name="repeat" size={21} color={post.reposted_by_me ? colors.brand : colors.textMuted} /><Text style={[styles.actionText, post.reposted_by_me && styles.actionActive]}>{formatNumber(post.repost_count)}</Text></Pressable>
      </View>
      {comments ? <View style={styles.comments}>
        {comments.length === 0 ? <Text style={styles.time}>{t("Be the first to comment")}</Text> : comments.map(comment => <View key={comment.id} style={styles.comment}><Text style={styles.commentAuthor}>{comment.author?.full_name || t("Member")}</Text><Text style={styles.commentText}>{comment.content}</Text></View>)}
        <View style={styles.commentRow}><TextInput value={draft} onChangeText={setDraft} maxLength={2000} editable={!busy} placeholder={t("Write a comment...")} placeholderTextColor={colors.textDim} style={styles.commentInput} /><Pressable accessibilityRole="button" accessibilityLabel={t("Send comment")} disabled={busy || !draft.trim()} onPress={() => void sendComment()} style={[styles.iconButton, (busy || !draft.trim()) && styles.disabled]}><Ionicons name="send" size={17} color={colors.brand} /></Pressable></View>
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  input: { minHeight: 56, maxHeight: 160, color: colors.text, fontSize: 15, lineHeight: 21 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, thumbWrap: { position: "relative" },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surface2 }, videoThumb: { alignItems: "center", justifyContent: "center" },
  removeThumb: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  composerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, counter: { flex: 1, color: colors.textDim, fontSize: 11, textAlign: "right" },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, disabled: { opacity: 0.4 },
  publish: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, publishText: { ...type.button, fontSize: 12 },
  error: { color: colors.error, fontSize: 12 },
  card: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  repostLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandDim, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.brand, fontWeight: "900" },
  author: { color: colors.text, fontWeight: "800" }, time: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  unavailable: { color: colors.textMuted, fontStyle: "italic" }, content: { color: colors.text, fontSize: 15, lineHeight: 22 },
  mediaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  media: { width: "49%", aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surface2, flexGrow: 1 }, mediaSingle: { width: "100%", aspectRatio: 4 / 3 },
  videoLabel: { color: colors.brand, fontSize: 10, fontWeight: "900", marginTop: 4 },
  actions: { flexDirection: "row", gap: spacing.xl, marginTop: 2 }, action: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { color: colors.textMuted, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] }, actionActive: { color: colors.brand },
  comments: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.sm },
  comment: { paddingVertical: 4 }, commentAuthor: { color: colors.brand, fontSize: 11, fontWeight: "900" }, commentText: { color: colors.text, lineHeight: 20 },
  commentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  commentInput: { flex: 1, minHeight: 40, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, color: colors.text },
});
