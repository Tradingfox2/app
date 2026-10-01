import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, type OwnedGym } from "@/src/api";
import { openGymCheckout } from "@/src/checkout";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

/** Owner desk. Loaded only when this route opens, never from first paint. */
export default function ManageGymScreen() {
  const { t, formatNumber } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ checkout?: string }>();
  const checkout = Array.isArray(params.checkout) ? params.checkout[0] : params.checkout;
  const [gyms, setGyms] = useState<OwnedGym[] | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const busy = useRef(false);
  const load = useCallback(() => {
    api.myGyms().then(setGyms).catch((cause) => {
      setGyms([]);
      setError(cause instanceof Error ? cause.message : t("Could not load gyms"));
    });
  }, [t]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const subscribe = async (gymId: string) => {
    if (busy.current) return;
    setError(""); setNote("");
    busy.current = true;
    try {
      await openGymCheckout(gymId);
    } catch (cause) {
      setError(t(cause instanceof Error ? cause.message : "Could not open checkout. Try again in a moment."));
    } finally {
      busy.current = false;
    }
  };
  const redeem = async (gymId: string) => {
    setError(""); setNote("");
    try {
      await api.redeemGymReward(gymId, (codes[gymId] || "").trim());
      setCodes((current) => ({ ...current, [gymId]: "" }));
      setNote(t("Redeemed"));
    } catch (cause) {
      setError(t(cause instanceof Error ? cause.message : "Could not redeem"));
    }
  };
  return (
    <SafeAreaView style={styles.safe} testID="gym-manage-screen">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
        <Text style={styles.headerTitle}>{t("MANAGE GYM")}</Text>
      </View>
      {gyms === null ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xxxl }} /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          {note ? <Text style={styles.note} testID="redeem-note">{note}</Text> : null}
          {checkout === "success" && gyms.some((gym) => gym.plan !== "partner") ? <Text style={styles.note} testID="partner-checkout-pending">{t("Payment is waiting for confirmation")}</Text> : null}
          {gyms.length === 0 ? <Text style={styles.empty}>{t("You do not own a gym yet.")}</Text> : null}
          {gyms.map((gym) => (
            <View key={gym.id} style={styles.card} testID={`owned-gym-${gym.id}`}>
              <Text style={styles.name}>{gym.name}</Text>
              <Text style={styles.meta}>{t(`GYM ${(gym.partner_status || "pending").toUpperCase()}`)} · {t(`GYM ${(gym.plan || "free").toUpperCase()}`)}{gym.reward?.title ? ` · ${gym.reward.title}` : ""}</Text>
              <View style={styles.metrics}>
                <View style={styles.metric}><Text style={styles.metricValue}>{formatNumber(gym.members_today)}</Text><Text style={styles.metricLabel}>{t("MEMBERS TODAY")}</Text></View>
                <View style={styles.metric}><Text style={styles.metricValue}>{formatNumber(gym.visits_week)}</Text><Text style={styles.metricLabel}>{t("VISITS THIS WEEK")}</Text></View>
              </View>
              {gym.plan !== "partner" ? <Pressable accessibilityRole="button" accessibilityLabel={t("BECOME A PARTNER")} testID={`gym-subscribe-${gym.id}`} onPress={() => void subscribe(gym.id)} style={styles.cta}><Text style={styles.ctaTxt}>{t("BECOME A PARTNER")}</Text></Pressable> : null}
              <TextInput value={codes[gym.id] || ""} onChangeText={(value) => setCodes((current) => ({ ...current, [gym.id]: value }))} autoCapitalize="characters" maxLength={32} placeholder={t("Reward code")} placeholderTextColor={colors.textDim} style={styles.input} testID={`redeem-code-${gym.id}`} />
              <Pressable accessibilityRole="button" accessibilityLabel={t("REDEEM")} testID={`redeem-${gym.id}`} onPress={() => void redeem(gym.id)} style={styles.cta}><Text style={styles.ctaTxt}>{t("REDEEM")}</Text></Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.section, color: colors.text, flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  card: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  name: { color: colors.text, fontWeight: "800", fontSize: 16 },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  metrics: { flexDirection: "row", marginTop: spacing.lg },
  metric: { flex: 1 },
  metricValue: { color: colors.text, fontSize: 26, fontWeight: "900" },
  metricLabel: { color: colors.textMuted, fontSize: 9, fontWeight: "800", marginTop: 4 },
  input: { marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, paddingHorizontal: spacing.md, minHeight: 44 },
  cta: { marginTop: spacing.md, alignSelf: "flex-start", backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 44, paddingHorizontal: spacing.xl, justifyContent: "center" },
  ctaTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 1, fontSize: 12 },
  error: { color: colors.error, marginBottom: spacing.md },
  note: { color: colors.success, marginBottom: spacing.md },
  empty: { color: colors.textMuted, fontSize: 14 },
});
