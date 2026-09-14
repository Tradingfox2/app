import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, type InvitePreview } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

/**
 * Where an invite link lands. Shows what the link leads to before joining —
 * including a private community, since holding the link is the point.
 *
 * The server decides the outcome: a plain invite grants only what joining
 * would (so an approval community still reviews the request), a manager's
 * invite skips approval, and no link ever opens a paid community or lifts a ban.
 */
export default function InviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter(); const { t } = useI18n();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (!code) return;
    setError("");
    try { setPreview(await api.previewInvite(code)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("This invite is not valid.")); }
  }, [code, t]);
  useFocusEffect(useCallback(() => { setPreview(null); void load(); }, [load]));

  const redeem = async () => {
    if (!code || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const membership = await api.redeemInvite(code);
      if (membership.status === "active") {
        router.replace({ pathname: "/community/[id]", params: { id: membership.community_id } });
      } else {
        await load();  // pending or banned: show the resulting state
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const status = preview?.membership_status;
  const community = preview?.community;
  const blockedReason = preview?.unusable_reason
    ? t(`This invite is ${preview.unusable_reason}.`)
    : community?.join_policy === "paid" ? t("Paid communities need verified billing to join.") : "";

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.canGoBack() ? router.back() : router.replace("/community")} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <Text style={styles.headerTitle}>{t("INVITATION")}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.scroll}>
      {!preview && !error ? <ActivityIndicator color={colors.brand} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error} testID="invite-error">{error}</Text> : null}
      {community ? <View style={styles.card} testID="invite-card">
        <Ionicons name="people" size={34} color={colors.brand} />
        <Text style={styles.name}>{community.name}</Text>
        {community.description ? <Text style={styles.description}>{community.description}</Text> : null}
        <Text style={styles.meta}>{t("{count} members").replace("{count}", String(community.member_count))}{!community.is_public ? ` · ${t("Private")}` : ""}</Text>

        {status === "active" ? <>
          <Text style={styles.note}>{t("You are already a member.")}</Text>
          <Pressable accessibilityRole="button" testID="invite-open" onPress={() => router.replace({ pathname: "/community/[id]", params: { id: community.id } })} style={styles.primary}><Text style={styles.primaryText}>{t("OPEN COMMUNITY")}</Text></Pressable>
        </> : status === "pending" ? <Text style={styles.note} testID="invite-pending">{t("Your request is waiting for a manager's approval.")}</Text>
          : status === "banned" ? <Text style={styles.note}>{t("You cannot join this community.")}</Text>
          : blockedReason ? <Text style={styles.note} testID="invite-unusable">{blockedReason}</Text>
          : <Pressable accessibilityRole="button" testID="invite-accept" disabled={busy} onPress={() => void redeem()} style={[styles.primary, busy && { opacity: 0.5 }]}>
              <Text style={styles.primaryText}>{t(preview?.skip_approval || community.join_policy === "open" ? "JOIN" : "REQUEST TO JOIN")}</Text>
            </Pressable>}
      </View> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl }, card: { alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, name: { ...type.screenTitle, fontSize: 22, textAlign: "center" }, description: { color: colors.textMuted, textAlign: "center", lineHeight: 20 }, meta: { color: colors.textDim, fontSize: 12 }, note: { color: colors.textMuted, textAlign: "center", marginTop: spacing.md }, primary: { alignSelf: "stretch", minHeight: 48, marginTop: spacing.md, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, primaryText: { color: colors.brandOn, fontWeight: "900", fontSize: 12, letterSpacing: 1 }, error: { color: colors.error, textAlign: "center" } });
