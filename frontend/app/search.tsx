import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, type Community, type Post, type SearchKind, type SearchPerson, type SearchTag } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { PostCard } from "@/src/components/social/feed";

/** Wait this long after the last keystroke, so typing a name is one query. */
const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

type Results = { users: SearchPerson[]; communities: Community[]; posts: Post[]; tags: SearchTag[] };

export default function SearchScreen() {
  const router = useRouter(); const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind>("users");
  const [results, setResults] = useState<Results>({ users: [], communities: [], posts: [], tags: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) { setResults({ users: [], communities: [], posts: [], tags: [] }); setLoading(false); return; }
    // Every keystroke bumps the revision, so a slow response for "dea" can
    // never overwrite the results for "deadlift" that arrived first.
    const current = ++revision.current;
    setLoading(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const rows = kind === "users" ? (await api.searchUsers(q)).results
          : kind === "communities" ? (await api.searchCommunities(q)).results
          : kind === "tags" ? (await api.searchTags(q)).results
          : (await api.searchPosts(q)).results;
        if (current === revision.current) setResults(prev => ({ ...prev, [kind]: rows }));
      } catch (cause) {
        if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Something went wrong"));
      } finally { if (current === revision.current) setLoading(false); }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, kind, t]);

  const active = query.trim().length >= MIN_QUERY;
  const rows = results[kind];

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance>
      <View style={styles.inputWrap}>
        <Ionicons name="search" size={16} color={colors.textDim} />
        <TextInput autoFocus value={query} onChangeText={value => { setQuery(value); if (value.startsWith("#")) setKind("tags"); }} maxLength={80} placeholder={t("Search people, communities, posts, #tags")} placeholderTextColor={colors.textDim} style={styles.input} testID="search-input" returnKeyType="search" />
        {query ? <Affordance accessibilityRole="button" accessibilityLabel={t("Clear")} testID="search-clear" onPress={() => setQuery("")}><Ionicons name="close-circle" size={16} color={colors.textDim} /></Affordance> : null}
      </View>
    </View>
    <View style={styles.tabs}>
      {(["users", "communities", "posts", "tags"] as SearchKind[]).map(item => (
        <Affordance key={item} accessibilityRole="button" testID={`search-tab-${item}`} onPress={() => setKind(item)} style={[styles.tab, kind === item && styles.tabOn]}>
          <Text style={[styles.tabText, kind === item && styles.tabTextOn]}>{t(item === "users" ? "PEOPLE" : item.toUpperCase())}</Text>
        </Affordance>
      ))}
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {loading ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.md }} /> : null}
    {!active ? <View style={styles.empty}><Ionicons name="search-outline" size={32} color={colors.textDim} /><Text style={styles.emptyText}>{t("Type at least two letters to search.")}</Text></View>
      : !loading && !error && rows.length === 0 ? <View style={styles.empty} testID="search-empty"><Text style={styles.emptyText}>{t("No results.")}</Text></View> : null}
    {active ? <FlatList
      data={rows as (SearchPerson | Community | Post | SearchTag)[]}
      keyExtractor={item => "tag" in item ? `tag-${item.tag}` : item.id}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => {
        if (kind === "users") {
          const person = item as SearchPerson;
          return <Affordance accessibilityRole="button" testID={`result-user-${person.id}`} onPress={() => router.push({ pathname: "/user/[id]", params: { id: person.id } })} style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{(person.full_name || "?").charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{person.full_name || t("Member")}</Text>
              <Text style={styles.meta}>{person.follow_state === "following" ? t("FOLLOWING") : person.follow_state === "pending" ? t("REQUESTED") : person.is_private ? t("Private") : " "}</Text>
            </View>
            {person.is_private ? <Ionicons name="lock-closed" size={14} color={colors.textDim} /> : null}
          </Affordance>;
        }
        if (kind === "tags") {
          const row = item as SearchTag;
          return <Affordance accessibilityRole="button" testID={`result-tag-${row.tag}`} onPress={() => router.push({ pathname: "/tag/[tag]", params: { tag: row.tag } })} style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarText}>#</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>#{row.tag}</Text>
              <Text style={styles.meta}>{t("{count} posts").replace("{count}", String(row.posts))}</Text>
            </View>
          </Affordance>;
        }
        if (kind === "communities") {
          const group = item as Community;
          return <Affordance accessibilityRole="button" testID={`result-community-${group.id}`} onPress={() => router.push({ pathname: "/community/[id]", params: { id: group.id } })} style={styles.row}>
            <View style={styles.avatar}><Ionicons name="people" size={18} color={colors.text} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{group.name}</Text>
              <Text numberOfLines={1} style={styles.meta}>{t("{count} members").replace("{count}", String(group.member_count))}{group.description ? ` · ${group.description}` : ""}</Text>
            </View>
          </Affordance>;
        }
        const post = item as Post;
        return <View testID={`result-post-${post.id}`}><PostCard post={post} onChange={next => setResults(prev => ({ ...prev, posts: prev.posts.map(row => row.id === next.id ? next : row) }))} onRemoved={() => setResults(prev => ({ ...prev, posts: prev.posts.filter(row => row.id !== post.id) }))} onReposted={() => undefined} /></View>;
      }}
    /> : null}
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, inputWrap: { flex: 1, height: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, input: { flex: 1, color: colors.text, fontSize: 15 }, tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }, tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong }, tabOn: { borderColor: colors.text, backgroundColor: colors.surface2 }, tabText: { color: colors.textMuted, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, tabTextOn: { color: colors.text }, list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl }, row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.text, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.text, fontSize: 16, fontWeight: "900" }, name: { color: colors.text, fontWeight: "800" }, meta: { color: colors.textDim, fontSize: 11, marginTop: 2 }, empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }, emptyText: { color: colors.textMuted }, error: { color: colors.error, paddingHorizontal: spacing.lg } });
