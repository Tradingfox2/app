import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, type FollowRequest } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

/**
 * Incoming follow requests, which only exist while the account is private.
 *
 * Denial is silent by design — the requester is never notified — so the row
 * simply disappears rather than reporting an outcome back to them.
 */
export default function FollowRequests() {
  const router = useRouter(); const { t, formatDate } = useI18n();
  const [rows, setRows] = useState<FollowRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0); const busy = useRef(false);

  const load = useCallback(async () => {
    const current = ++revision.current; setError("");
    try {
      const data = await api.followRequests();
      if (current === revision.current) setRows(data);
    } catch (cause) {
      if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Could not load follow requests"));
    } finally { if (current === revision.current) setLoading(false); }
  }, [t]);

  useFocusEffect(useCallback(() => {
    busy.current = false; setLoading(true); void load();
    return () => { revision.current += 1; };
  }, [load]));

  const decide = async (request: FollowRequest, approve: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (approve) await api.approveFollowRequest(request.follower_id);
      else await api.denyFollowRequest(request.follower_id);
      setRows(current => current.filter(row => row.follower_id !== request.follower_id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
      await load();
    } finally { busy.current = false; }
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{t("FOLLOW REQUESTS")}</Text>
        {rows.length ? <Text style={styles.count}>{t("{count} waiting").replace("{count}", String(rows.length))}</Text> : null}
      </View>
    </View>
    {error ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.error}>{error}</Text><Affordance accessibilityRole="button" onPress={() => void load()} style={styles.icon}><Text style={styles.retry}>{t("Retry")}</Text></Affordance></View> : null}
    {loading && !error ? <ActivityIndicator color={colors.text} /> : null}
    <FlatList
      data={rows}
      keyExtractor={item => item.follower_id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={!loading && !error ? <View style={styles.empty}>
        <Ionicons name="person-add-outline" size={32} color={colors.textDim} />
        <Text style={styles.emptyText}>{t("No follow requests.")}</Text>
        <Text style={styles.emptyHint}>{t("Requests only arrive while your account is private.")}</Text>
      </View> : null}
      renderItem={({ item }) => <View style={styles.row} testID={`request-${item.follower_id}`}>
        <Affordance accessibilityRole="button" onPress={() => router.push({ pathname: "/user/[id]", params: { id: item.follower_id } })} style={styles.person}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(item.follower?.full_name || "?").charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.name}>{item.follower?.full_name || t("Member")}</Text>
            <Text style={styles.time}>{formatDate(item.created_at, { month: "short", day: "numeric" })}</Text>
          </View>
        </Affordance>
        <Affordance accessibilityRole="button" accessibilityLabel={t("Reject")} testID={`deny-${item.follower_id}`} onPress={() => void decide(item, false)} style={styles.deny}><Ionicons name="close" size={19} color={colors.error} /></Affordance>
        <Affordance signal="brand" accessibilityRole="button" accessibilityLabel={t("Approve")} testID={`approve-${item.follower_id}`} onPress={() => void decide(item, true)} style={styles.approve}><Ionicons name="checkmark" size={19} color={colors.brandOn} /></Affordance>
      </View>}
    />
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, count: { color: colors.text, fontSize: 9, fontWeight: "900", marginTop: 3 }, list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl }, row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, person: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68 }, avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.text, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.text, fontSize: 16, fontWeight: "900" }, name: { color: colors.text, fontWeight: "800" }, time: { color: colors.textDim, fontSize: 10, marginTop: 2 }, deny: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" }, approve: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.sm }, emptyText: { color: colors.textMuted }, emptyHint: { color: colors.textDim, fontSize: 12, textAlign: "center", maxWidth: 300 }, errorBox: { paddingHorizontal: spacing.lg }, error: { color: colors.error }, retry: { color: colors.text, fontWeight: "900" } });
