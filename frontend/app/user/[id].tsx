import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

type Profile = Awaited<ReturnType<typeof api.publicProfile>>;

export default function PublicProfile() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { user } = useAuth(); const { t, formatNumber } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const revision = useRef(0); const busyRef = useRef(false);
  const load = useCallback(async () => {
    if (!id) return; const current = ++revision.current; setError("");
    try { const row = await api.publicProfile(id); if (current === revision.current) setProfile(row); }
    catch (cause) { if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
  }, [id, t]);
  useFocusEffect(useCallback(() => { setProfile(null); void load(); return () => { revision.current += 1; }; }, [load]));
  const toggleFollow = async () => {
    if (!profile || busyRef.current) return; busyRef.current = true; setBusy(true);
    try { if (profile.followed_by_me) await api.unfollow(profile.id); else await api.follow(profile.id); await load(); }
    catch { setError(t("Something went wrong")); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const own = profile?.id === user?.id;
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.headerTitle}>{t("PROFILE")}</Text></View>
    <ScrollView contentContainerStyle={styles.scroll}>
      {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.icon}><Text style={styles.retry}>{t("Retry")}</Text></Pressable></View> : null}
      {!profile && !error ? <ActivityIndicator color={colors.brand} /> : null}
      {profile ? <>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(profile.full_name || "?").charAt(0).toUpperCase()}</Text></View>
        <Text style={styles.name}>{profile.full_name || t("Member")}</Text>
        <View style={styles.stats}>{[[profile.posts, "POSTS"], [profile.followers, "FOLLOWERS"], [profile.following, "FOLLOWING"]].map(([value, label]) => <View key={String(label)} style={styles.stat}><Text style={styles.statValue}>{formatNumber(Number(value))}</Text><Text style={styles.statLabel}>{t(String(label))}</Text></View>)}</View>
        {!own ? <View style={styles.actions}>
          <Pressable accessibilityRole="button" testID="follow-toggle" disabled={busy} onPress={() => void toggleFollow()} style={[styles.primary, profile.followed_by_me && styles.secondary, busy && styles.disabled]}><Text style={[styles.primaryText, profile.followed_by_me && styles.secondaryText]}>{t(profile.followed_by_me ? "FOLLOWING" : "FOLLOW")}</Text></Pressable>
          <Pressable accessibilityRole="button" testID="message-user" disabled={!profile.can_message} onPress={() => router.push({ pathname: "/dm/[id]", params: { id: profile.id, name: profile.full_name || "" } })} style={[styles.secondary, !profile.can_message && styles.disabled]}><Ionicons name="chatbubble-outline" size={16} color={colors.text} /><Text style={styles.secondaryText}>{t("MESSAGE")}</Text></Pressable>
        </View> : null}
        {!own && !profile.can_message ? <Text style={styles.hint}>{t("Messaging unlocks when you follow each other, share a community, or have a coaching relationship.")}</Text> : null}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, scroll: { padding: spacing.lg, alignItems: "center", gap: spacing.md, paddingBottom: spacing.xxxl }, avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandDim, borderWidth: 2, borderColor: colors.brand, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.brand, fontSize: 32, fontWeight: "900" }, name: { ...type.screenTitle, fontSize: 24 }, stats: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.sm }, stat: { alignItems: "center" }, statValue: { color: colors.text, fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"] }, statLabel: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1 }, actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }, primary: { minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }, primaryText: { ...type.button, fontSize: 12 }, secondary: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: "transparent" }, secondaryText: { color: colors.text, fontSize: 12, fontWeight: "900", letterSpacing: 1 }, disabled: { opacity: 0.4 }, hint: { color: colors.textMuted, fontSize: 12, textAlign: "center", maxWidth: 360, lineHeight: 18 }, error: { color: colors.error }, retry: { color: colors.brand, fontWeight: "900" } });
