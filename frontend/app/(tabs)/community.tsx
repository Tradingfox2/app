import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, User } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

type Tab = "feed" | "coaches" | "sessions";

export default function Community() {
  const [tab, setTab] = useState<Tab>("feed");
  const [posts, setPosts] = useState<any[]>([]);
  const [coaches, setCoaches] = useState<User[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [newPost, setNewPost] = useState("");

  const load = useCallback(async () => {
    const [p, c, s] = await Promise.all([
      api.posts().catch(() => []),
      api.coaches().catch(() => []),
      api.groupSessions().catch(() => []),
    ]);
    setPosts(p);
    setCoaches(c);
    setSessions(s);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitPost = async () => {
    if (!newPost.trim()) return;
    await api.createPost(newPost.trim());
    setNewPost("");
    await load();
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="community-screen">
      <View style={styles.header}>
        <Text style={styles.title}>COMMUNITY</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsRow}
        contentContainerStyle={styles.chipsContent}
      >
        {(["feed", "coaches", "sessions"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            testID={`community-tab-${t}`}
            style={[styles.chip, tab === t && styles.chipActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.chipTxt, tab === t && styles.chipTxtActive]}>
              {t.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === "feed" && (
        <>
          <View style={styles.composer}>
            <TextInput
              testID="input-new-post"
              style={styles.composerInput}
              placeholder="Share your session, PR, or thought…"
              placeholderTextColor={colors.textDim}
              value={newPost}
              onChangeText={setNewPost}
              multiline
            />
            <Pressable
              testID="submit-post-btn"
              style={styles.composerBtn}
              onPress={submitPost}
            >
              <Ionicons name="send" color={colors.brandOn} size={16} />
            </Pressable>
          </View>
          <FlatList
            data={posts}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.listPad}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={40} color={colors.textDim} />
                <Text style={styles.emptyTxt}>Be the first to post</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.postCard}>
                <View style={styles.postHead}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarTxt}>
                      {(item.author?.full_name ?? item.author?.email ?? "?")
                        .charAt(0)
                        .toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.postAuthor}>
                      {item.author?.full_name ?? item.author?.email}
                    </Text>
                    <Text style={styles.postTime}>
                      {new Date(item.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
                <Text style={styles.postBody}>{item.content}</Text>
                <View style={styles.postFoot}>
                  <View style={styles.iconMeta}>
                    <Ionicons name="flame-outline" color={colors.textMuted} size={14} />
                    <Text style={styles.iconMetaTxt}>{item.like_count ?? 0}</Text>
                  </View>
                  <View style={styles.iconMeta}>
                    <Ionicons name="chatbubble-outline" color={colors.textMuted} size={14} />
                    <Text style={styles.iconMetaTxt}>{item.comment_count ?? 0}</Text>
                  </View>
                </View>
              </View>
            )}
          />
        </>
      )}

      {tab === "coaches" && (
        <FlatList
          data={coaches}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.listPad}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="person-outline" size={40} color={colors.textDim} />
              <Text style={styles.emptyTxt}>No coaches yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.coachCard} testID={`coach-${item.id}`}>
              <View style={styles.avatarLg}>
                <Text style={styles.avatarTxt}>
                  {(item.full_name ?? item.email).charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.coachName}>
                  {item.full_name ?? item.email}
                </Text>
                <Text style={styles.coachRole}>CERTIFIED COACH</Text>
              </View>
              <Pressable style={styles.followBtn}>
                <Text style={styles.followTxt}>CONTACT</Text>
              </Pressable>
            </View>
          )}
        />
      )}

      {tab === "sessions" && (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listPad}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="videocam-outline" size={40} color={colors.textDim} />
              <Text style={styles.emptyTxt}>No live sessions scheduled</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.sessionCard}>
              <View style={styles.sessionPill}>
                <Text style={styles.sessionPillTxt}>
                  {new Date(item.starts_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.postAuthor}>{item.title}</Text>
                <Text style={styles.postTime}>
                  {item.duration_min} min ·{" "}
                  {item.price_cents === 0
                    ? "FREE"
                    : `${(item.price_cents / 100).toFixed(2)} ${item.currency}`}
                </Text>
              </View>
              <Pressable style={styles.followBtn}>
                <Text style={styles.followTxt}>JOIN</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { color: colors.text, fontSize: 24, fontWeight: "900", letterSpacing: 2 },
  chipsRow: { maxHeight: 56 },
  chipsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", height: 56 },
  chip: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.brandDim },
  chipTxt: { color: colors.textMuted, fontWeight: "700", fontSize: 11, letterSpacing: 1 },
  chipTxtActive: { color: colors.brand },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  composerInput: {
    flex: 1,
    color: colors.text,
    minHeight: 40,
    maxHeight: 100,
  },
  composerBtn: {
    backgroundColor: colors.brand,
    padding: spacing.sm + 2,
    borderRadius: radius.pill,
  },
  listPad: { padding: spacing.lg, paddingBottom: 120 },
  postCard: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  postHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarTxt: { color: colors.brand, fontWeight: "900" },
  postAuthor: { color: colors.text, fontWeight: "700" },
  postTime: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  postBody: { color: colors.text, lineHeight: 20 },
  postFoot: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.md },
  iconMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconMetaTxt: { color: colors.textMuted, fontSize: 12 },
  coachCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  coachName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  coachRole: {
    color: colors.brand,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "800",
    marginTop: 2,
  },
  followBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  followTxt: { color: colors.brandOn, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  sessionPill: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionPillTxt: { color: colors.brand, fontWeight: "900", fontSize: 12 },
  empty: { alignItems: "center", padding: spacing.xxxl, gap: spacing.md },
  emptyTxt: { color: colors.textMuted },
});
