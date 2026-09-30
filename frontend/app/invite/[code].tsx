import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, type InvitePreview } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { openCheckout } from "@/src/checkout";

/**
 * Where an invite link lands. Shows what the link leads to before joining —
 * including a private community, since holding the link is the point.
 *
 * The server decides the outcome: a plain invite grants only what joining
 * would (so an approval community still reviews the request), a manager's
 * invite skips approval, a paid community's link leads to Checkout (only the
 * payment lets you in), and no link ever lifts a ban.
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

  // A paid community: the invite opens Checkout; only the payment lets you in.
  const subscribe = async () => {
    const communityId = preview?.community?.id;
    if (!code || !communityId || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (await openCheckout(communityId, code) === "closed") {
        router.replace({ pathname: "/community/[id]", params: { id: communityId, checkout: "returned" } });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const status = preview?.membership_status;
  const community = preview?.community;
  const paid = community?.join_policy === "paid";
  const blockedReason = preview?.unusable_reason ? t(`This invite is ${preview.unusable_reason}.`) : "";

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.canGoBack() ? router.back() : router.replace("/community")} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <Text style={styles.headerTitle}>{t("INVITATION")}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.scroll}>
      {!preview && !error ? <ActivityIndicator color={colors.text} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error} testID="invite-error">{error}</Text> : null}
      {preview && !community ? <View style={styles.card} testID="invite-dead">
        <Ionicons name="lock-closed-outline" size={34} color={colors.textDim} />
        <Text style={styles.note}>{blockedReason || t("This invite no longer works.")}</Text>
        <Text style={styles.meta}>{t("Ask a member for a fresh link.")}</Text>
      </View> : null}
      {community ? <View style={styles.card} testID="invite-card">
        <Ionicons name="people" size={34} color={colors.text} />
        <Text style={styles.name}>{community.name}</Text>
        {community.description ? <Text style={styles.description}>{community.description}</Text> : null}
        <Text style={styles.meta}>{t("{count} members").replace("{count}", String(community.member_count))}{!community.is_public ? ` · ${t("Private")}` : ""}</Text>

        {status === "active" ? <>
          <Text style={styles.note}>{t("You are already a member.")}</Text>
          <Pressable accessibilityRole="button" testID="invite-open" onPress={() => router.replace({ pathname: "/community/[id]", params: { id: community.id } })} style={styles.primary}><Text style={styles.primaryText}>{t("OPEN COMMUNITY")}</Text></Pressable>
        </> : status === "pending" ? <Text style={styles.note} testID="invite-pending">{t("Your request is waiting for a manager's approval.")}</Text>
          : status === "banned" ? <Text style={styles.note}>{t("You cannot join this community.")}</Text>
          : blockedReason ? <Text style={styles.note} testID="invite-unusable">{blockedReason}</Text>
          : <>
            {paid ? <Text style={styles.note} testID="invite-paid">{t("Monthly, by card through Stripe. Leave any time and the subscription stops.")}</Text> : null}
            <Pressable accessibilityRole="button" testID="invite-accept" disabled={busy} onPress={() => void (paid ? subscribe() : redeem())} style={[styles.primary, busy && { opacity: 0.5 }]}>
              <Text style={styles.primaryText}>{t(paid ? "SUBSCRIBE" : preview?.skip_approval || community.join_policy === "open" ? "JOIN" : "REQUEST TO JOIN")}</Text>
            </Pressable>
          </>}
      </View> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl }, card: { alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, name: { ...type.screenTitle, fontSize: 22, textAlign: "center" }, description: { color: colors.textMuted, textAlign: "center", lineHeight: 20 }, meta: { color: colors.textDim, fontSize: 12 }, note: { color: colors.textMuted, textAlign: "center", marginTop: spacing.md }, primary: { alignSelf: "stretch", minHeight: 48, marginTop: spacing.md, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, primaryText: { color: colors.brandOn, fontWeight: "900", fontSize: 12, letterSpacing: 1 }, error: { color: colors.error, textAlign: "center" } });
