import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Affordance } from "@/src/press-affordance";
import { useAuth } from "@/src/auth-context";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import {
  buyStorePackage,
  hasProEntitlement,
  purchaseCancelled,
  restoreStorePurchases,
  storeOffers,
  type StoreOffer,
} from "@/src/purchases";
import { card, colors, radius, spacing } from "@/src/theme";

function isPro(plan: string | undefined): boolean {
  return plan === "pro" || plan === "pro_monthly" || plan === "pro_yearly";
}

function periodLabel(interval: StoreOffer["interval"], translate: (source: string) => string): string {
  switch (interval) {
    case "month":
      return translate("MONTHLY");
    case "year":
      return translate("YEARLY");
    default: {
      const unreachable: never = interval;
      return unreachable;
    }
  }
}

async function waitUntilPro(): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await api.currentSub().catch(() => null);
    if (isPro(current?.plan)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

export default function ProPaywall() {
  const { user } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const alive = useRef(true);
  const [offers, setOffers] = useState<StoreOffer[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [storeSeesPro, setStoreSeesPro] = useState(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    // A cold open of /pro happens before the router can move, so the browser
    // goes to Settings itself. Native never takes this branch.
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.replace("/settings");
      return;
    }
    const userId = user?.id;
    if (!userId) return;
    let cancelled = false;
    void storeOffers(userId)
      .then((rows) => {
        if (cancelled) return;
        if (rows === null) setUnavailable(true);
        else setOffers(rows);
      })
      .catch(() => { if (!cancelled) setError(t("Store purchases are not set up on this build.")); });
    return () => { cancelled = true; };
  }, [t, user?.id]);

  const finish = async (info: { entitlements: { active: { pro?: unknown } } } | null) => {
    if (!alive.current) return;
    setStoreSeesPro(hasProEntitlement(info));
    setConfirming(true);
    const granted = await waitUntilPro();
    if (!alive.current) return;
    if (granted) router.back();
    else setError(t("Pro is not active yet. If you paid, it appears here within a few minutes."));
  };

  const buy = (offer: StoreOffer) => {
    if (busy || !user?.id || Platform.OS === "web") return;
    setBusy(true);
    setRestoring(false);
    setError("");
    void buyStorePackage(user.id, offer.pkg)
      .then((info) => finish(info))
      .catch((cause: unknown) => {
        if (!purchaseCancelled(cause) && alive.current) setError(t("Could not complete the purchase."));
      })
      .finally(() => { if (alive.current) { setBusy(false); setConfirming(false); } });
  };

  const restore = () => {
    if (busy || !user?.id || Platform.OS === "web") return;
    setBusy(true);
    setRestoring(true);
    setError("");
    void restoreStorePurchases(user.id)
      .then((info) => finish(info))
      .catch(() => { if (alive.current) setError(t("Could not restore purchases.")); })
      .finally(() => { if (alive.current) { setBusy(false); setRestoring(false); setConfirming(false); } });
  };

  if (Platform.OS === "web") {
    return <SafeAreaView edges={["top"]} style={styles.safe} />;
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="pro-screen">
      <View style={styles.header}>
        <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.headerIcon}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Affordance>
        <Text style={styles.headerTitle}>PRO</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.copy}>{t("Monthly or yearly in the App Store or Play Store.")}</Text>
        {confirming ? <Text style={styles.hint}>{t("CONFIRMING PURCHASE…")}</Text> : null}
        {storeSeesPro ? <Text style={styles.hint}>{t("The store sees Pro. IronFlow turns it on after the webhook.")}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {unavailable ? <Text style={styles.hint}>{t("Store purchases are not set up on this build.")}</Text> : null}
        {offers === null && !unavailable && !error ? <ActivityIndicator color={colors.text} style={styles.spinner} /> : null}
        {offers?.length === 0 ? <Text style={styles.hint}>{t("No monthly or yearly product is available yet.")}</Text> : null}
        {offers?.map((offer) => (
          <Affordance
            key={offer.interval}
            accessibilityRole="button"
            disabled={busy}
            testID={offer.interval === "year" ? "store-yearly" : "store-monthly"}
            onPress={() => buy(offer)}
            style={styles.card}
          >
            <Text style={styles.name}>{periodLabel(offer.interval, t)}</Text>
            {offer.price ? <Text style={styles.price}>{offer.price}</Text> : null}
          </Affordance>
        ))}
        <Affordance accessibilityRole="button" disabled={busy} testID="store-restore" onPress={restore} style={styles.card}>
          <Text style={styles.name}>{restoring ? t("RESTORING…") : t("RESTORE PURCHASES")}</Text>
        </Affordance>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.text, fontWeight: "900", letterSpacing: 2, fontSize: 16 },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  copy: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: spacing.lg },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: spacing.md },
  error: { color: colors.error, fontSize: 13, marginBottom: spacing.md },
  spinner: { marginVertical: spacing.lg },
  card: { ...card, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm },
  name: { color: colors.text, fontWeight: "900", letterSpacing: 2 },
  price: { color: colors.text, fontSize: 22, fontWeight: "800", marginTop: 4 },
});
