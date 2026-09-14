import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, type Connection } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

/**
 * Followers and following for one account.
 *
 * A static sibling of `user/[id].tsx` rather than `user/[id]/followers.tsx`:
 * that leaf has no sibling directory, and adding one would collide with it.
 */
type Tab = "followers" | "following";

export default function Connections() {
  const params = useLocalSearchParams<{ id: string; tab?: Tab; name?: string }>();
  const router = useRouter(); const { user } = useAuth(); const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(params.tab === "following" ? "following" : "followers");
  const [rows, setRows] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0); const busy = useRef(false);

  const load = useCallback(async (which: Tab) => {
    if (!params.id) return;
    const current = ++revision.current; setError("");
    try {
      const data = which === "followers" ? await api.followers(params.id) : await api.followingList(params.id);
      if (current === revision.current) setRows(data);
    } catch (cause) {
      // A private account answers 403 here; show the reason, not an empty list.
      if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { if (current === revision.current) setLoading(false); }
  }, [params.id, t]);

  useFocusEffect(useCallback(() => {
    busy.current = false; setLoading(true); setRows([]); void load(tab);
    return () => { revision.current += 1; };
  }, [load, tab]));

  const toggleFollow = async (person: Connection) => {
    if (busy.current) return;
    busy.current = true;
    // Optimistic: this list can be long and a full refetch would lose scroll.
    setRows(current => current.map(row => row.id === person.id ? { ...row, followed_by_me: !row.followed_by_me } : row));
    try { if (person.followed_by_me) await api.unfollow(person.id); else await api.follow(person.id); }
    catch (cause) {
      setRows(current => current.map(row => row.id === person.id ? { ...row, followed_by_me: person.followed_by_me } : row));
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { busy.current = false; }
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <Text numberOfLines={1} style={styles.headerTitle}>{params.name || t("PROFILE")}</Text>
    </View>
    <View style={styles.tabs}>
      {(["followers", "following"] as Tab[]).map(item => (
        <Pressable key={item} accessibilityRole="button" testID={`connections-tab-${item}`} onPress={() => { setTab(item); setLoading(true); }} style={[styles.tab, tab === item && styles.tabOn]}>
          <Text style={[styles.tabText, tab === item && styles.tabTextOn]}>{t(item.toUpperCase())}</Text>
        </Pressable>
      ))}
    </View>
    {error ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load(tab)} style={styles.icon}><Text style={styles.retry}>{t("Retry")}</Text></Pressable></View> : null}
    {loading && !error ? <ActivityIndicator color={colors.brand} /> : null}
    <FlatList
      data={rows}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={!loading && !error ? <View style={styles.empty}><Ionicons name="people-outline" size={32} color={colors.textDim} /><Text style={styles.emptyText}>{t(tab === "followers" ? "No followers yet." : "Not following anyone yet.")}</Text></View> : null}
      renderItem={({ item }) => <View style={styles.row} testID={`connection-${item.id}`}>
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/user/[id]", params: { id: item.id } })} style={styles.person}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(item.full_name || "?").charAt(0).toUpperCase()}</Text></View>
          <Text numberOfLines={1} style={styles.name}>{item.full_name || t("Member")}</Text>
        </Pressable>
        {item.id !== user?.id ? <Pressable accessibilityRole="button" testID={`follow-${item.id}`} onPress={() => void toggleFollow(item)} style={[styles.follow, item.followed_by_me && styles.followOn]}>
          <Text style={[styles.followText, item.followed_by_me && styles.followTextOn]}>{t(item.followed_by_me ? "FOLLOWING" : "FOLLOW")}</Text>
        </Pressable> : null}
      </View>}
    />
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text, flex: 1 }, tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }, tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong }, tabOn: { borderColor: colors.brand, backgroundColor: colors.surface2 }, tabText: { color: colors.textMuted, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, tabTextOn: { color: colors.brand }, list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl }, row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, person: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64 }, avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandDim, borderWidth: 1, borderColor: colors.brand, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.brand, fontSize: 16, fontWeight: "900" }, name: { color: colors.text, fontWeight: "800", flex: 1 }, follow: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, followOn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.borderStrong }, followText: { color: colors.brandOn, fontSize: 10, fontWeight: "900", letterSpacing: 1 }, followTextOn: { color: colors.text }, empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }, emptyText: { color: colors.textMuted }, errorBox: { paddingHorizontal: spacing.lg }, error: { color: colors.error }, retry: { color: colors.brand, fontWeight: "900" } });
