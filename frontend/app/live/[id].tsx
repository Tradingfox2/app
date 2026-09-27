import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, type LiveSession } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function statusLabel(status: LiveSession["status"], t: (source: string) => string): string {
  switch (status) {
    case "live":
      return t("LIVE");
    case "scheduled":
      return t("Scheduled");
    case "ended":
      return t("Ended");
    case "cancelled":
      return t("Cancelled");
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * `ironflow://live/{id}` → this screen. Loads GET /live-sessions/{id}.
 * In-app join and presence belong to the livestream room; until that lands,
 * this shows the session the API returned, RSVP, and an external join link
 * only when the session actually has one.
 */
export default function LiveScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = one(params.id);
  const router = useRouter();
  const { user } = useAuth();
  const { t, formatDate } = useI18n();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setError("");
    if (!id) {
      setSession(null);
      setError(t("Something went wrong"));
      return () => { cancelled = true; };
    }
    api.getLiveSession(id).then(row => { if (!cancelled) setSession(row); })
      .catch(cause => {
        if (cancelled) return;
        setSession(null);
        setError(cause instanceof Error ? cause.message : t("Something went wrong"));
      });
    return () => { cancelled = true; };
  }, [id, t]));

  const rsvp = async () => {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      setSession(await (session.rsvped ? api.cancelRsvp(session.id) : api.rsvpLive(session.id)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  };

  const open = session?.status === "scheduled" || session?.status === "live";
  const hosting = !!session && session.host_id === user?.id;
  const showJoin = !!session?.join_url && (session.status === "live" || hosting);

  return <SafeAreaView style={styles.safe} testID="live-screen">
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <Text style={styles.title} numberOfLines={1}>{session?.title || t("LIVE SESSIONS")}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.body}>
      {error ? <Text accessibilityRole="alert" style={styles.error} testID="live-error">{error}</Text> : null}
      {!session && !error ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} /> : null}
      {session ? <View style={styles.card} testID={`live-${session.id}`}>
        <View style={styles.statusRow}>
          {session.status === "live" ? <View style={styles.liveBadge} testID="live-badge"><Text style={styles.liveBadgeText}>{t("LIVE")}</Text></View> : null}
          <Text style={styles.status} testID="live-status">{statusLabel(session.status, t)}</Text>
        </View>
        <Text style={styles.meta}>
          {formatDate(session.starts_at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {" · "}{session.duration_min} min
          {" · "}{session.host?.full_name || t("Coach")}
          {" · "}{t("{count} going").replace("{count}", String(session.rsvp_count))}
        </Text>
        {session.description ? <Text style={styles.description}>{session.description}</Text> : null}
        <View style={styles.actions}>
          {open ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void rsvp()} style={session.rsvped ? styles.secondary : styles.primary} testID="live-rsvp">
            <Text style={session.rsvped ? styles.secondaryText : styles.primaryText}>{t(session.rsvped ? "GOING ✓" : "I'M IN")}</Text>
          </Pressable> : null}
          {showJoin ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(session.join_url!)} style={styles.primary} testID="live-join">
            <Text style={styles.primaryText}>{t("JOIN")}</Text>
          </Pressable> : null}
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/channel/[id]", params: { id: session.channel_id } })} style={styles.secondary} testID="live-channel">
            <Text style={styles.secondaryText}>{t("Open channel")}</Text>
          </Pressable>
        </View>
      </View> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: colors.text, fontWeight: "900", letterSpacing: 1 },
  body: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.sm },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  status: { color: colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  liveBadge: { backgroundColor: colors.error, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  liveBadgeText: { color: colors.text, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  meta: { color: colors.textMuted, fontSize: 13 },
  description: { color: colors.text, fontSize: 15 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  primary: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.brandOn, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  secondary: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  error: { color: colors.error, fontSize: 14 },
});
