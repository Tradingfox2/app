import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { track } from "@/src/analytics";
import { audienceHint, audienceLabel, audienceTestId, limitedAudienceLabel, type PersonalAudience } from "@/src/audience-copy";
import { api, mediaUrl, type Community, type LinkPreview, type MediaItem, type Poll, type Post, type PostComment, type WorkoutSummary } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { SAVE_LABEL } from "@/src/community-copy";
import { sharePost } from "@/src/share";
import { ActionSheet, type SheetAction } from "./action-sheet";
import { Avatar } from "./avatar";
import { MediaGrid } from "./media";
import { MentionInput } from "./mention-input";
import { ReportSheet, type ReportTarget } from "./report-sheet";
import { RichText } from "./rich-text";
import { ShareBar } from "./share-bar";

type Scope = "all" | "following" | "mine" | "friends";
export type FeedFilters = { author_id?: string; tag?: string; community_id?: string };

/** Must match the backend default page size for `GET /feed`. */
const PAGE_SIZE = 20;
const MAX_ATTACHMENTS = 6;

export function useFeed(filters: FeedFilters = {}, initialScope: Scope = "all") {
  const { t } = useI18n();
  const [scope, setScope] = useState<Scope>(initialScope);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // The API returns no has_more flag, so a full page is the only signal that
  // another one might exist.
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const moreBusy = useRef(false);
  const { author_id, tag, community_id } = filters;

  const load = useCallback(async (nextScope: Scope = scope) => {
    const current = ++revision.current;
    try {
      const rows = await api.feed(nextScope, undefined, { author_id, tag, community_id });
      if (current !== revision.current) return;
      setPosts(rows);
      setHasMore(rows.length === PAGE_SIZE);
      // Clear only after a real page arrives, so a retry never flashes "No posts".
      setError("");
    } catch (cause) {
      if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [scope, t, author_id, tag, community_id]);

  // Reads the revision without bumping it: a refresh or scope change that
  // lands mid-request invalidates this append instead of racing it.
  const loadMore = useCallback(async () => {
    const oldest = posts[posts.length - 1];
    if (!oldest || moreBusy.current || !hasMore) return;
    moreBusy.current = true; setLoadingMore(true);
    const current = revision.current;
    try {
      const rows = await api.feed(scope, oldest.id, { author_id, tag, community_id });
      if (current !== revision.current) return;
      setPosts(existing => {
        const seen = new Set(existing.map(row => row.id));
        return [...existing, ...rows.filter(row => !seen.has(row.id))];
      });
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      if (current === revision.current) setError(t("Something went wrong"));
    } finally { moreBusy.current = false; setLoadingMore(false); }
  }, [posts, scope, hasMore, t, author_id, tag, community_id]);

  const changeScope = (next: Scope) => { setScope(next); setLoading(true); void load(next); };
  const patch = (id: string, updater: (post: Post) => Post) => setPosts(rows => rows.map(row => row.id === id ? updater(row) : row));
  const prepend = (post: Post) => setPosts(rows => [post, ...rows.filter(row => row.id !== post.id)]);
  const remove = (id: string) => setPosts(rows => rows.filter(row => row.id !== id));
  const stop = () => { revision.current += 1; };
  return { scope, changeScope, posts, loading, loadingMore, hasMore, error, load, loadMore, patch, prepend, remove, stop };
}

const POLL_DURATIONS: [number, string][] = [[1, "1 h"], [24, "1 day"], [72, "3 days"], [168, "1 week"]];
const PERSONAL_AUDIENCES: PersonalAudience[] = ["friends", "public", "only_me"];

/**
 * The post composer. `communityId` pins it to one community's wall; without
 * it the author may choose public or any community they belong to.
 */
export function Composer({ onPublished, communityId, personal }: { onPublished: (post: Post) => void; communityId?: string; personal?: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [personalAudience, setPersonalAudience] = useState<PersonalAudience>("friends");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState<"upload" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [poll, setPoll] = useState<{ options: string[]; hours: number } | null>(null);
  const [audience, setAudience] = useState<string | null>(communityId ?? null);
  const [mine, setMine] = useState<Community[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [workouts, setWorkouts] = useState<{ id: string; title: string; ended_at?: string | null; duration_sec?: number | null }[] | null>(null);
  const [pickingWorkout, setPickingWorkout] = useState(false);
  const busyRef = useRef(false);

  const pick = async () => {
    if (busyRef.current || media.length >= MAX_ATTACHMENTS) return;
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

  const openAudience = async () => {
    setPicking(open => !open);
    if (!mine) api.communities("mine").then(rows => setMine(rows.filter(row => row.membership?.status === "active"))).catch(() => setMine([]));
  };

  const openWorkouts = () => {
    setPickingWorkout(open => !open);
    if (workouts) return;
    api.workouts()
      .then(rows => setWorkouts((rows as { id: string; title: string; ended_at?: string | null; duration_sec?: number | null }[]).filter(row => row.ended_at)))
      .catch(cause => setError(cause instanceof Error ? cause.message : t("Something went wrong")));
  };

  const pollReady = !poll || (poll.options.filter(option => option.trim()).length >= 2 && text.trim().length > 0);
  const hasWorkout = !!communityId && !!workoutId;
  const canPublish = !busy && pollReady && (text.trim().length > 0 || media.length > 0 || hasWorkout);

  const publish = async () => {
    if (busyRef.current || !canPublish) return;
    busyRef.current = true; setBusy("publish"); setError("");
    try {
      // Only what was set travels, so a plain post's body stays exactly
      // { content, media_ids }.
      const post = await api.publish({
        content: text.trim(),
        media_ids: media.map(item => item.id),
        ...(audience && !personal ? { community_id: audience } : {}),
        ...(personal ? { audience: personalAudience } : {}),
        ...(hasWorkout && workoutId ? { workout_id: workoutId } : {}),
        ...(poll ? { poll: { options: poll.options.map(option => option.trim()).filter(Boolean), duration_hours: poll.hours } } : {}),
      });
      // Best-effort: a failed analytics post must not fail the publish.
      track("post_created", {
        post_id: post.id,
        has_media: media.length > 0,
        has_poll: poll !== null,
        ...(audience ? { community_id: audience } : {}),
      });
      setText(""); setMedia([]); setPoll(null); setWorkoutId(null); setPickingWorkout(false); onPublished(post);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { busyRef.current = false; setBusy(null); }
  };

  const audienceName = audience ? (mine?.find(row => row.id === audience)?.name ?? t("Community")) : t("Public");
  return (
    <View style={styles.composer} testID="feed-composer">
      <MentionInput testID="composer-text" value={text} onChangeText={setText} multiline maxLength={4000} editable={!busy} placeholder={t(poll ? "Ask a question..." : "Share a PR, a session, a progress photo...")} placeholderTextColor={colors.textDim} style={styles.input} />
      {poll ? <View style={styles.pollEditor} testID="poll-editor">
        {poll.options.map((option, index) => <View key={index} style={styles.pollOptionRow}>
          <TextInput value={option} maxLength={80} onChangeText={value => setPoll({ ...poll, options: poll.options.map((item, i) => i === index ? value : item) })} placeholder={t("Option {n}").replace("{n}", String(index + 1))} placeholderTextColor={colors.textDim} style={styles.pollOptionInput} testID={`poll-option-${index}`} />
          {poll.options.length > 2 ? <Pressable accessibilityRole="button" accessibilityLabel={t("Remove option")} onPress={() => setPoll({ ...poll, options: poll.options.filter((_, i) => i !== index) })} style={styles.iconButton}><Ionicons name="close" size={16} color={colors.textDim} /></Pressable> : null}
        </View>)}
        {poll.options.length < 4 ? <Pressable accessibilityRole="button" onPress={() => setPoll({ ...poll, options: [...poll.options, ""] })} testID="poll-add-option"><Text style={styles.link}>{t("+ Add option")}</Text></Pressable> : null}
        <View style={styles.chips}>{POLL_DURATIONS.map(([hours, label]) => <Pressable key={hours} accessibilityRole="button" onPress={() => setPoll({ ...poll, hours })} style={[styles.chip, poll.hours === hours && styles.chipOn]} testID={`poll-duration-${hours}`}><Text style={[styles.chipText, poll.hours === hours && styles.chipTextOn]}>{t(label)}</Text></Pressable>)}</View>
      </View> : null}
      {media.length ? <View style={styles.thumbs}>{media.map(item => <View key={item.id} style={styles.thumbWrap}>{item.kind === "image" ? <Image source={{ uri: mediaUrl(item.url) }} style={styles.thumb} accessibilityIgnoresInvertColors /> : <View style={[styles.thumb, styles.videoThumb]}><Ionicons name="videocam" size={22} color={colors.text} /></View>}<Pressable accessibilityRole="button" accessibilityLabel={t("Remove attachment")} onPress={() => setMedia(items => items.filter(x => x.id !== item.id))} style={styles.removeThumb}><Ionicons name="close" size={12} color={colors.text} /></Pressable></View>)}</View> : null}
      {personal ? <View testID="personal-audience">
        <View style={styles.chips}>
          {PERSONAL_AUDIENCES.map(option => (
            <Pressable key={option} accessibilityRole="button" onPress={() => setPersonalAudience(option)} style={[styles.chip, personalAudience === option && styles.chipOn]} testID={audienceTestId("composer-audience", option)}>
              <Text style={[styles.chipText, personalAudience === option && styles.chipTextOn]}>{t(audienceLabel(option))}</Text>
            </Pressable>
          ))}
        </View>
        <Text testID="personal-audience-hint" style={styles.audienceHint}>{t(audienceHint(personalAudience))}</Text>
      </View> : null}
      {picking && !communityId && !personal ? <View style={styles.chips} testID="audience-picker">
        <Pressable accessibilityRole="button" onPress={() => { setAudience(null); setPicking(false); }} style={[styles.chip, !audience && styles.chipOn]} testID="audience-public"><Text style={[styles.chipText, !audience && styles.chipTextOn]}>{t("Public")}</Text></Pressable>
        {mine === null ? <ActivityIndicator color={colors.text} /> : mine.map(row => <Pressable key={row.id} accessibilityRole="button" onPress={() => { setAudience(row.id); setPicking(false); }} style={[styles.chip, audience === row.id && styles.chipOn]} testID={`audience-${row.id}`}><Text style={[styles.chipText, audience === row.id && styles.chipTextOn]}>{row.name}</Text></Pressable>)}
      </View> : null}
      {communityId && pickingWorkout ? <View style={styles.chips} testID="composer-workouts">
        {workouts === null ? <ActivityIndicator color={colors.text} /> : workouts.length === 0 ? <Text style={styles.time}>{t("Finish a workout to share it on the wall.")}</Text> : workouts.map(workout => {
          const on = workout.id === workoutId;
          return <Pressable key={workout.id} accessibilityRole="button" testID={`composer-workout-${workout.id}`} onPress={() => { setWorkoutId(workout.id); setPickingWorkout(false); }} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{workout.title}</Text>
          </Pressable>;
        })}
      </View> : null}
      {hasWorkout ? <View style={styles.chips} testID="composer-workout-selected">
        <Text style={styles.chipTextOn}>{workouts?.find(row => row.id === workoutId)?.title || t("Workout")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Remove workout")} testID="composer-workout-remove" onPress={() => setWorkoutId(null)} style={styles.iconButton}><Ionicons name="close" size={14} color={colors.textDim} /></Pressable>
      </View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.composerRow}>
        {communityId ? <Pressable accessibilityRole="button" accessibilityLabel={t("Attach workout")} testID="composer-attach-workout" disabled={!!busy} onPress={openWorkouts} style={[styles.iconButton, !!busy && styles.disabled]}>
          <Ionicons name={workoutId ? "barbell" : "barbell-outline"} size={20} color={colors.text} />
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={t("Add photo or video")} disabled={!!busy || media.length >= MAX_ATTACHMENTS} onPress={() => void pick()} style={[styles.iconButton, (!!busy || media.length >= MAX_ATTACHMENTS) && styles.disabled]}>
          {busy === "upload" ? <ActivityIndicator color={colors.text} /> : <Ionicons name="image-outline" size={20} color={colors.text} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t(poll ? "Remove poll" : "Add poll")} testID="composer-poll" onPress={() => setPoll(poll ? null : { options: ["", ""], hours: 24 })} style={styles.iconButton}>
          <Ionicons name={poll ? "stats-chart" : "stats-chart-outline"} size={19} color={colors.text} />
        </Pressable>
        {!communityId && !personal ? <Pressable accessibilityRole="button" accessibilityLabel={t("Choose audience")} testID="composer-audience" onPress={() => void openAudience()} style={styles.audience}>
          <Ionicons name={audience ? "people" : "globe-outline"} size={14} color={colors.textMuted} /><Text style={styles.audienceText} numberOfLines={1}>{audienceName}</Text>
        </Pressable> : null}
        <Text style={styles.counter}>{text.length ? `${text.length}/4000` : ""}</Text>
        <Pressable accessibilityRole="button" testID="feed-publish" disabled={!canPublish} onPress={() => void publish()} style={[styles.publish, !canPublish && styles.disabled]}>
          {busy === "publish" ? <ActivityIndicator color={colors.brandOn} /> : <Text style={styles.publishText}>{t("POST")}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

type PostCardProps = {
  post: Post;
  onChange: (next: Post) => void;
  onRemoved: () => void;
  onReposted: (post: Post) => void;
  /** Open the comment thread straight away, as on a post's own screen. */
  initiallyOpen?: boolean;
  /** Keep the copy / network share row visible, as on the post screen. */
  shareTargets?: boolean;
};

export function PostCard({ post, onChange, onRemoved, onReposted, initiallyOpen, shareTargets }: PostCardProps) {
  const { t, formatDate, formatNumber } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(!!initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [quoting, setQuoting] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(!!shareTargets);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  // A plain repost is a frame around someone else's post: every action on the
  // card — like, comment, save, vote — belongs to the original.
  const plainRepost = !!post.repost_of && !post.content && !!post.original && !post.original.unavailable;
  const shown: Post = plainRepost ? post.original! : post;
  const quoted = post.repost_of && post.content ? post.original : null;

  const apply = (updates: Partial<Post>) => onChange(plainRepost ? { ...post, original: { ...post.original!, ...updates } } : { ...post, ...updates });

  const guard = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const toggleLike = () => guard(async () => {
    const result = shown.liked_by_me ? await api.unlikePost(shown.id) : await api.likePost(shown.id);
    apply({ liked_by_me: result.liked, like_count: result.like_count });
  });
  const toggleRepost = () => guard(async () => {
    if (shown.reposted_by_me) {
      await api.undoRepost(shown.id);
      apply({ reposted_by_me: false, repost_count: Math.max(0, shown.repost_count - 1) });
      return;
    }
    const created = await api.repost(shown.id);
    apply({ reposted_by_me: true, repost_count: shown.repost_count + 1 });
    onReposted(created);
  });
  const sendQuote = () => guard(async () => {
    if (!quoting?.trim()) return;
    const created = await api.repost(shown.id, quoting.trim());
    apply({ repost_count: shown.repost_count + 1 });
    setQuoting(null); onReposted(created);
  });
  const toggleKudos = () => guard(async () => {
    const result = shown.kudos_by_me ? await api.removeKudos(shown.id) : await api.giveKudos(shown.id);
    apply({ kudos_by_me: result.kudos, kudos_count: result.kudos_count });
  });
  const toggleSave = () => guard(async () => {
    const result = shown.saved_by_me ? await api.unsavePost(shown.id) : await api.savePost(shown.id);
    apply({ saved_by_me: result.saved });
  });
  const vote = (option: number) => guard(async () => { const updated = await api.vote(shown.id, option); apply({ poll: updated.poll }); });
  const saveEdit = () => guard(async () => {
    if (editing === null) return;
    const updated = await api.editPost(post.id, editing);
    onChange({ ...post, ...updated }); setEditing(null);
  });
  const remove = () => guard(async () => { await api.deletePost(post.id); onRemoved(); });
  const openPost = () => router.push({ pathname: "/post/[id]", params: { id: shown.id } });
  const shareOut = () => {
    setShareOpen(true);
    const snippet = shown.content ? shown.content.slice(0, 120) : undefined;
    void sharePost({ id: shown.id, title: shown.author?.full_name || "IronFlow", message: snippet }).then(result => {
      if (result === "unavailable") setError(t("Could not open the share sheet. Use copy or a network button."));
    });
  };

  const own = post.author_id === user?.id;
  const audienceMark = limitedAudienceLabel(shown.audience);
  const actions: SheetAction[] = [
    ...(own && post.can_edit && !plainRepost ? [{ key: "edit", label: t("Edit post"), icon: "create-outline" as const, onPress: () => setEditing(post.content) }] : []),
    { key: "save", label: t(shown.saved_by_me ? "Remove from saved" : "Save post"), icon: shown.saved_by_me ? "bookmark" as const : "bookmark-outline" as const, onPress: () => void toggleSave() },
    { key: "share", label: t("Share"), icon: "share-outline" as const, onPress: shareOut },
    { key: "open", label: t("Open post"), icon: "open-outline" as const, onPress: openPost },
    ...(!own ? [{ key: "report", label: t("Report post"), icon: "flag-outline" as const, onPress: () => setReporting({ target_type: "post", target_id: shown.id }) }] : []),
    ...(own ? [{ key: "delete", label: t("Delete post"), icon: "trash-outline" as const, destructive: true, onPress: () => void remove() }] : []),
  ];

  return (
    <View style={styles.card} testID={`post-${post.id}`}>
      {plainRepost ? <Text style={styles.repostLabel}><Ionicons name="repeat" size={12} color={colors.textMuted} /> {t("{name} reposted", { name: post.author?.full_name || t("Member") })}</Text> : null}
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel={shown.author?.full_name || t("Member")} onPress={() => shown.author && router.push({ pathname: "/user/[id]", params: { id: shown.author.id } })}><Avatar user={shown.author} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Open post")} testID={`post-open-${shown.id}`} onPress={openPost} style={{ flex: 1 }}>
          <Text style={styles.author}>{shown.author?.full_name || t("Member")}</Text>
          <Text style={styles.time}>{formatDate(shown.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{shown.edited_at ? ` · ${t("edited")}` : ""}{audienceMark ? ` · ${t(audienceMark)}` : ""}{shown.community_id ? ` · ${t("Community")}` : ""}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("More options")} testID={`post-menu-${post.id}`} onPress={() => setMenu(true)} style={styles.iconButton}><Ionicons name="ellipsis-horizontal" size={18} color={colors.textDim} /></Pressable>
      </View>
      {post.original?.unavailable ? <Text style={styles.unavailable}>{t("This post is no longer available.")}</Text> : null}
      {editing !== null ? <View style={styles.editBox} testID={`post-edit-${post.id}`}>
        <MentionInput value={editing} onChangeText={setEditing} multiline maxLength={4000} style={styles.editInput} testID="post-edit-input" />
        <View style={styles.editRow}>
          <Pressable accessibilityRole="button" onPress={() => setEditing(null)}><Text style={styles.linkMuted}>{t("Cancel")}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t(SAVE_LABEL)} testID="post-edit-save" disabled={busy || !editing.trim()} onPress={() => void saveEdit()}><Text style={[styles.link, (busy || !editing.trim()) && styles.disabled]}>{t(SAVE_LABEL)}</Text></Pressable>
        </View>
      </View> : shown.content ? <RichText content={shown.content} mentions={shown.mentions} style={styles.content} /> : null}
      {shown.poll ? <PollBlock poll={shown.poll} disabled={busy} onVote={index => void vote(index)} /> : null}
      {shown.workout_summary ? <WorkoutCard summary={shown.workout_summary} kudosCount={shown.kudos_count ?? 0} kudosMine={!!shown.kudos_by_me} busy={busy} onKudos={() => void toggleKudos()} /> : null}
      {shown.media?.length ? <MediaGrid media={shown.media} testID={`post-media-${shown.id}`} /> : null}
      {shown.link_preview ? <LinkCard preview={shown.link_preview} /> : null}
      {quoted ? <QuotedPost post={quoted} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={shown.liked_by_me ? t("Unlike") : t("Like")} accessibilityState={{ selected: !!shown.liked_by_me }} disabled={busy} onPress={() => void toggleLike()} style={styles.action}><Ionicons name={shown.liked_by_me ? "heart" : "heart-outline"} size={20} color={shown.liked_by_me ? colors.text : colors.textMuted} /><Text style={[styles.actionText, shown.liked_by_me && styles.actionActive]}>{formatNumber(shown.like_count)}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Comments")} onPress={() => setOpen(value => !value)} style={styles.action}><Ionicons name="chatbubble-outline" size={19} color={colors.textMuted} /><Text style={styles.actionText}>{formatNumber(shown.comment_count)}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={shown.reposted_by_me ? t("Undo repost") : t("Repost")} accessibilityState={{ selected: !!shown.reposted_by_me }} disabled={busy} onPress={() => void toggleRepost()} style={styles.action}><Ionicons name="repeat" size={21} color={shown.reposted_by_me ? colors.text : colors.textMuted} /><Text style={[styles.actionText, shown.reposted_by_me && styles.actionActive]}>{formatNumber(shown.repost_count)}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Quote")} testID={`post-quote-${post.id}`} disabled={busy} onPress={() => setQuoting(quoting === null ? "" : null)} style={styles.action}><Ionicons name="chatbox-ellipses-outline" size={19} color={quoting !== null ? colors.text : colors.textMuted} /></Pressable>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel={t("Share")} accessibilityState={{ expanded: shareTargets || shareOpen }} testID={`post-share-${shown.id}`} onPress={() => setShareOpen(open => !open)} style={styles.action}><Ionicons name="share-outline" size={19} color={shareTargets || shareOpen ? colors.text : colors.textMuted} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={shown.saved_by_me ? t("Remove from saved") : t("Save post")} testID={`post-save-${post.id}`} disabled={busy} onPress={() => void toggleSave()} style={styles.action}><Ionicons name={shown.saved_by_me ? "bookmark" : "bookmark-outline"} size={19} color={shown.saved_by_me ? colors.text : colors.textMuted} /></Pressable>
      </View>
      {shareTargets || shareOpen ? <ShareBar postId={shown.id} title={shown.author?.full_name || "IronFlow"} message={shown.content} /> : null}
      {quoting !== null ? <View style={styles.commentRow} testID={`quote-box-${post.id}`}>
        <MentionInput value={quoting} onChangeText={setQuoting} maxLength={4000} placeholder={t("Add your take...")} placeholderTextColor={colors.textDim} style={styles.commentInput} testID="quote-input" />
        <Pressable accessibilityRole="button" accessibilityLabel={t("Post quote")} testID="quote-send" disabled={busy || !quoting.trim()} onPress={() => void sendQuote()} style={[styles.iconButton, (busy || !quoting.trim()) && styles.disabled]}><Ionicons name="send" size={17} color={colors.text} /></Pressable>
      </View> : null}
      {open ? <CommentThread post={shown} onCountChange={delta => apply({ comment_count: Math.max(0, shown.comment_count + delta) })} onReport={setReporting} /> : null}
      <ActionSheet visible={menu} actions={actions} onClose={() => setMenu(false)} testID={`post-sheet-${post.id}`} />
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </View>
  );
}

/** Results appear once you vote or the poll closes — nobody herds the vote. */
function PollBlock({ poll, disabled, onVote }: { poll: Poll; disabled: boolean; onVote: (index: number) => void }) {
  const { t, formatDate } = useI18n();
  const reveal = poll.counts !== null;
  return <View style={styles.poll} testID="poll">
    {poll.options.map((option, index) => {
      const count = poll.counts?.[index] ?? 0;
      const share = reveal && poll.total ? count / poll.total : 0;
      const mine = poll.my_vote === index;
      return reveal
        ? <View key={index} style={styles.pollResult} testID={`poll-result-${index}`}>
          <View style={[styles.pollBar, { width: `${Math.round(share * 100)}%` }, mine && styles.pollBarMine]} />
          <Text style={[styles.pollLabel, mine && styles.actionActive]}>{option}{mine ? " ✓" : ""}</Text>
          <Text style={styles.pollPct}>{Math.round(share * 100)}%</Text>
        </View>
        : <Pressable key={index} accessibilityRole="button" disabled={disabled || poll.closed} onPress={() => onVote(index)} style={styles.pollOption} testID={`poll-vote-${index}`}><Text style={styles.pollOptionText}>{option}</Text></Pressable>;
    })}
    <Text style={styles.time}>{poll.total === 1 ? t("1 vote") : t("{count} votes").replace("{count}", String(poll.total))} · {poll.closed ? t("Final results") : t("Ends {date}").replace("{date}", formatDate(poll.closes_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</Text>
  </View>;
}

function LinkCard({ preview }: { preview: LinkPreview }) {
  // A preview image that will not load leaves no empty grey slot behind.
  const [imageFailed, setImageFailed] = useState(false);
  return <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(preview.url)} style={styles.linkCard} testID="link-preview">
    {preview.image_url && !imageFailed ? <Image source={{ uri: preview.image_url }} onError={() => setImageFailed(true)} style={styles.linkImage} accessibilityIgnoresInvertColors /> : null}
    <View style={styles.linkBody}>
      <Text style={styles.linkSite} numberOfLines={1}>{preview.site_name}</Text>
      <Text style={styles.linkTitle} numberOfLines={2}>{preview.title}</Text>
      {preview.description ? <Text style={styles.linkDesc} numberOfLines={2}>{preview.description}</Text> : null}
    </View>
  </Pressable>;
}

function QuotedPost({ post }: { post: Post & { unavailable?: boolean } }) {
  const { t } = useI18n();
  const router = useRouter();
  if (post.unavailable) return <View style={styles.quoted}><Text style={styles.unavailable}>{t("This post is no longer available.")}</Text></View>;
  return <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/post/[id]", params: { id: post.id } })} style={styles.quoted} testID={`quoted-${post.id}`}>
    <View style={styles.quotedHead}><Avatar user={post.author} size={20} /><Text style={styles.author}>{post.author?.full_name || t("Member")}</Text></View>
    {post.content ? <RichText content={post.content} mentions={post.mentions} style={styles.commentText} numberOfLines={4} /> : null}
    {post.media?.length ? <Text style={styles.time}>{t("{count} attachments").replace("{count}", String(post.media.length))}</Text> : null}
  </Pressable>;
}

/**
 * Comments under a post: one level of replies, likes, edit within 15 minutes,
 * delete for the author or the post's author, report for everyone else.
 */
function CommentThread({ post, onCountChange, onReport }: { post: Post; onCountChange: (delta: number) => void; onReport: (target: ReportTarget) => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [rows, setRows] = useState<PostComment[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [editError, setEditError] = useState("");
  const loaded = useRef(false);
  const commentGen = useRef(0);

  const guard = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { setBusy(false); }
  };
  const loadComments = () => {
    const gen = ++commentGen.current;
    setLoadError("");
    api.comments(post.id).then(page => {
      if (gen !== commentGen.current) return;
      setRows(page);
      setHasOlder(page.length === 50);
    }).catch(cause => {
      if (gen !== commentGen.current) return;
      setLoadError(cause instanceof Error ? cause.message : t("Something went wrong"));
    });
  };
  if (!loaded.current) {
    loaded.current = true;
    loadComments();
  }
  const retryComments = () => {
    setRows(null);
    setHasOlder(false);
    loadComments();
  };
  const older = () => guard(async () => {
    if (!rows?.length) return;
    const page = await api.comments(post.id, rows[0].id);
    setRows([...page, ...rows]); setHasOlder(page.length === 50);
  });
  const send = () => guard(async () => {
    if (!draft.trim()) return;
    const created = await api.addComment(post.id, draft.trim(), replyTo?.parent_id || replyTo?.id);
    setRows(current => {
      const next = [...(current || []), created];
      return created.parent_id ? next.map(row => row.id === created.parent_id ? { ...row, reply_count: (row.reply_count ?? 0) + 1 } : row) : next;
    });
    setDraft(""); setReplyTo(null); onCountChange(1);
  });
  const like = (comment: PostComment) => guard(async () => {
    const result = comment.liked_by_me ? await api.unlikeComment(comment.id) : await api.likeComment(comment.id);
    setRows(current => (current || []).map(row => row.id === comment.id ? { ...row, liked_by_me: result.liked, like_count: result.like_count } : row));
  });
  const saveEdit = () => {
    if (busy) return;
    const current = editing;
    if (!current?.text.trim()) {
      setEditError(t("Write something before saving."));
      return;
    }
    const commentId = current.id;
    const content = current.text.trim();
    setEditError("");
    void guard(async () => {
      const updated = await api.editComment(commentId, content);
      setRows(rows => (rows || []).map(row => row.id === updated.id ? { ...row, ...updated } : row));
      setEditing(null);
    });
  };
  const remove = (comment: PostComment) => guard(async () => {
    await api.deleteComment(comment.id);
    setRows(current => (current || []).filter(row => row.id !== comment.id).map(row => row.id === comment.parent_id ? { ...row, reply_count: Math.max(0, (row.reply_count ?? 1) - 1) } : row));
    onCountChange(-1);
  });

  const topLevel = (rows || []).filter(row => !row.parent_id || !(rows || []).some(other => other.id === row.parent_id));
  const repliesOf = (id: string) => (rows || []).filter(row => row.parent_id === id);
  const renderComment = (comment: PostComment, nested: boolean) => {
    const mine = comment.author_id === user?.id;
    const canDelete = mine || post.author_id === user?.id;
    return <View key={comment.id} style={[styles.comment, nested && styles.reply]} testID={`comment-${comment.id}`}>
      <View style={styles.commentHead}>
        <Avatar user={comment.author} size={22} />
        <Text style={styles.commentAuthor}>{comment.author?.full_name || t("Member")}</Text>
        {comment.edited_at ? <Text style={styles.time}>{t("edited")}</Text> : null}
      </View>
      {editing?.id === comment.id
        ? <View style={styles.commentEdit}>
            <View style={styles.commentRow}>
              <TextInput value={editing.text} onChangeText={text => { setEditing({ id: comment.id, text }); if (text.trim()) setEditError(""); }} maxLength={2000} style={styles.commentInput} testID="comment-edit-input" />
              <Pressable accessibilityRole="button" accessibilityLabel={t(SAVE_LABEL)} accessibilityState={{ disabled: busy || !editing.text.trim(), busy }} disabled={busy || !editing.text.trim()} onPress={() => void saveEdit()} testID="comment-edit-save">
                {busy ? <ActivityIndicator color={colors.text} size="small" /> : <Text style={[styles.link, !editing.text.trim() && styles.disabled]}>{t(SAVE_LABEL)}</Text>}
              </Pressable>
            </View>
            {!editing.text.trim() || editError ? <Text accessibilityRole="alert" testID="comment-edit-error" style={styles.error}>{editError || t("Write something before saving.")}</Text> : null}
          </View>
        : <RichText content={comment.content} mentions={comment.mentions} style={styles.commentText} />}
      <View style={styles.commentActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={comment.liked_by_me ? t("Unlike comment") : t("Like comment")} onPress={() => void like(comment)} style={styles.commentAction}><Ionicons name={comment.liked_by_me ? "heart" : "heart-outline"} size={14} color={comment.liked_by_me ? colors.text : colors.textDim} />{comment.like_count ? <Text style={styles.time}>{comment.like_count}</Text> : null}</Pressable>
        <Pressable accessibilityRole="button" onPress={() => setReplyTo(comment)} testID={`comment-reply-${comment.id}`}><Text style={styles.commentLink}>{t("Reply")}</Text></Pressable>
        {mine && comment.can_edit ? <Pressable accessibilityRole="button" onPress={() => { setEditError(""); setEditing({ id: comment.id, text: comment.content }); }} testID={`comment-edit-${comment.id}`}><Text style={styles.commentLink}>{t("Edit")}</Text></Pressable> : null}
        {canDelete ? <Pressable accessibilityRole="button" onPress={() => void remove(comment)} testID={`comment-delete-${comment.id}`}><Text style={[styles.commentLink, { color: colors.error }]}>{t("Delete")}</Text></Pressable> : null}
        {!mine ? <Pressable accessibilityRole="button" onPress={() => onReport({ target_type: "comment", target_id: comment.id })} testID={`comment-report-${comment.id}`}><Text style={styles.commentLink}>{t("Report")}</Text></Pressable> : null}
      </View>
      {!nested ? repliesOf(comment.id).map(reply => renderComment(reply, true)) : null}
    </View>;
  };

  return <View style={styles.comments}>
    {rows === null && !loadError ? <ActivityIndicator color={colors.text} /> : null}
    {loadError ? <View accessibilityRole="alert" testID="comments-error">
      <Text style={styles.error}>{loadError}</Text>
      <Pressable accessibilityRole="button" testID="comments-retry" onPress={retryComments}><Text style={styles.link}>{t("Retry")}</Text></Pressable>
    </View> : null}
    {hasOlder ? <Pressable accessibilityRole="button" onPress={() => void older()} testID="comments-older"><Text style={styles.link}>{t("View earlier comments")}</Text></Pressable> : null}
    {rows && rows.length === 0 && !loadError ? <Text style={styles.time}>{t("Be the first to comment")}</Text> : null}
    {topLevel.map(comment => renderComment(comment, false))}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {replyTo ? <View style={styles.replyingTo}><Text style={styles.time}>{t("Replying to {name}").replace("{name}", replyTo.author?.full_name || t("Member"))}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Cancel reply")} onPress={() => setReplyTo(null)}><Ionicons name="close" size={14} color={colors.textDim} /></Pressable></View> : null}
    <View style={styles.commentRow}>
      <View style={{ flex: 1 }}><MentionInput value={draft} onChangeText={setDraft} maxLength={2000} editable={!busy} placeholder={t("Write a comment...")} placeholderTextColor={colors.textDim} style={styles.commentInput} testID="comment-input" /></View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Send comment")} disabled={busy || !draft.trim()} onPress={() => void send()} style={[styles.iconButton, (busy || !draft.trim()) && styles.disabled]}><Ionicons name="send" size={17} color={colors.text} /></Pressable>
    </View>
  </View>;
}

/** A shared session. Numbers are the snapshot taken when it was posted. */
function WorkoutCard({ summary, kudosCount, kudosMine, busy, onKudos }: { summary: WorkoutSummary; kudosCount: number; kudosMine: boolean; busy: boolean; onKudos: () => void }) {
  const { t, formatNumber } = useI18n();
  const minutes = summary.duration_sec ? Math.round(summary.duration_sec / 60) : null;
  const stats: [string, string][] = [
    [String(summary.sets), t("SETS")],
    [`${formatNumber(Math.round(summary.tonnage_kg))} kg`, t("VOLUME")],
    ...(minutes ? [[`${minutes} min`, t("TIME")] as [string, string]] : []),
    ...(summary.perceived_effort ? [[`${summary.perceived_effort}/10`, t("EFFORT")] as [string, string]] : []),
  ];
  const more = summary.exercise_count - summary.exercises.length;
  return <View style={styles.workoutCard} testID={`workout-card-${summary.workout_id}`}>
    <View style={styles.workoutHead}><Ionicons name="barbell" size={16} color={colors.text} /><Text style={styles.workoutTitle}>{summary.title}</Text></View>
    <View style={styles.workoutStats}>{stats.map(([value, label]) => <View key={label} style={styles.workoutStat}><Text style={styles.workoutValue}>{value}</Text><Text style={styles.workoutLabel}>{label}</Text></View>)}</View>
    {summary.exercises.length ? <Text style={styles.workoutExercises} numberOfLines={2}>{summary.exercises.join(" · ")}{more > 0 ? ` +${more}` : ""}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={t("Kudos")} accessibilityState={{ selected: kudosMine }} testID={`post-kudos-${summary.workout_id}`} disabled={busy} onPress={onKudos} style={styles.kudos}>
      <Ionicons name={kudosMine ? "ribbon" : "ribbon-outline"} size={16} color={kudosMine ? colors.text : colors.textMuted} />
      <Text style={[styles.kudosText, kudosMine && styles.actionActive]}>{t("Kudos")} · {formatNumber(kudosCount)}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({ workoutCard: { marginTop: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, gap: spacing.sm }, workoutHead: { flexDirection: "row", alignItems: "center", gap: 6 }, workoutTitle: { color: colors.text, fontWeight: "600", fontSize: 16 }, workoutStats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg }, workoutStat: { minWidth: 56 }, workoutValue: { color: colors.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] }, workoutLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "400" }, workoutExercises: { color: colors.textMuted, fontSize: 13 },
  composer: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  input: { minHeight: 56, maxHeight: 160, color: colors.text, fontSize: 15, lineHeight: 21 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, thumbWrap: { position: "relative" },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surface2 }, videoThumb: { alignItems: "center", justifyContent: "center" },
  removeThumb: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  composerRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, counter: { flex: 1, color: colors.textDim, fontSize: 11, textAlign: "right" },
  audience: { maxWidth: 140, minHeight: 32, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  audienceText: { color: colors.textMuted, fontSize: 11, fontWeight: "700", flexShrink: 1 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, disabled: { opacity: 0.4 },
  publish: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, publishText: { ...type.button, fontSize: 12 },
  error: { color: colors.error, fontSize: 12 },
  audienceHint: { color: colors.textDim, fontSize: 12, lineHeight: 16 },
  kudos: { alignSelf: "flex-start", minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6 },
  kudosText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  chipOn: { borderColor: colors.text, backgroundColor: colors.surface2 },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" }, chipTextOn: { color: colors.text },
  pollEditor: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  pollOptionRow: { flexDirection: "row", alignItems: "center" },
  pollOptionInput: { flex: 1, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, color: colors.text },
  link: { color: colors.text, fontWeight: "800", fontSize: 13 }, linkMuted: { color: colors.textMuted, fontWeight: "700", fontSize: 13 },
  card: { padding: spacing.lg, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  repostLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  author: { color: colors.text, fontWeight: "800" }, time: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  unavailable: { color: colors.textMuted, fontStyle: "italic" }, content: { color: colors.text, fontSize: 15, lineHeight: 22 },
  editBox: { gap: spacing.xs }, editInput: { minHeight: 64, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, color: colors.text },
  editRow: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.lg },
  poll: { gap: spacing.xs },
  pollOption: { minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.text, justifyContent: "center", paddingHorizontal: spacing.md },
  pollResult: { minHeight: 40, borderRadius: radius.sm, overflow: "hidden", flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, backgroundColor: colors.surface2 },
  pollBar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.surface3 }, pollBarMine: { backgroundColor: colors.surface2 },
  pollLabel: { flex: 1, color: colors.text, fontWeight: "700" }, pollOptionText: { color: colors.text, fontWeight: "700" }, pollPct: { color: colors.textMuted, fontWeight: "800", fontVariant: ["tabular-nums"] },
  linkCard: { borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  linkImage: { width: "100%", aspectRatio: 1.91, backgroundColor: colors.surface2 },
  linkBody: { padding: spacing.md, gap: 2 }, linkSite: { color: colors.textDim, fontSize: 11 }, linkTitle: { color: colors.text, fontWeight: "800" }, linkDesc: { color: colors.textMuted, fontSize: 12 },
  quoted: { borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  quotedHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: 2 }, action: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { color: colors.textMuted, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] }, actionActive: { color: colors.text },
  comments: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.sm },
  comment: { paddingVertical: 4, gap: 2 }, reply: { marginLeft: spacing.xl, paddingLeft: spacing.md, borderLeftWidth: 1, borderLeftColor: colors.border },
  commentHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  commentAuthor: { color: colors.text, fontSize: 11, fontWeight: "900" }, commentText: { color: colors.text, lineHeight: 20 },
  commentActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  commentAction: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 28 },
  commentLink: { color: colors.textDim, fontSize: 11, fontWeight: "800" },
  replyingTo: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  commentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  commentEdit: { gap: 4 },
  commentInput: { flex: 1, minHeight: 40, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, color: colors.text },
});
