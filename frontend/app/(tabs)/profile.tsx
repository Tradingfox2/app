import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth-context";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

const PLANS: { key: string; name: string; price: string; features: string[] }[] = [
  { key: "free", name: "FREE", price: "€0", features: ["Workout tracker", "50 exercises", "Community feed"] },
  { key: "pro", name: "PRO", price: "€9.90 / mo", features: ["Biomarker uploads", "Wearable sync", "AI insights"] },
  { key: "elite", name: "ELITE", price: "€29 / mo", features: ["1:1 coach", "Group sessions", "Priority support"] },
];

export default function Profile() {
  const { user, logout } = useAuth();
  const [sub, setSub] = useState<any>(null);
  const [ref, setRef] = useState<any>(null);

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      api.currentSub().catch(() => ({ plan: "free" })),
      api.referral().catch(() => null),
    ]);
    setSub(s);
    setRef(r);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectPlan = async (plan: string) => {
    await api.setSub(plan);
    await load();
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="profile-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroAvatar}>
            <Text style={styles.heroAvatarTxt}>
              {(user?.full_name ?? user?.email ?? "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.heroName}>{user?.full_name ?? user?.email}</Text>
          <Text style={styles.heroRole}>{user?.role?.toUpperCase()}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SUBSCRIPTION</Text>
          {PLANS.map((p) => {
            const active = (sub?.plan ?? "free") === p.key;
            return (
              <Pressable
                key={p.key}
                testID={`plan-${p.key}-btn`}
                onPress={() => selectPlan(p.key)}
                style={[styles.planCard, active && styles.planCardActive]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.planHead}>
                    <Text style={styles.planName}>{p.name}</Text>
                    {active && (
                      <View style={styles.planBadge}>
                        <Text style={styles.planBadgeTxt}>CURRENT</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.planPrice}>{p.price}</Text>
                  <View style={{ marginTop: spacing.sm, gap: 4 }}>
                    {p.features.map((f) => (
                      <View
                        key={f}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                      >
                        <Ionicons name="checkmark" size={12} color={colors.brand} />
                        <Text style={styles.planFeature}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>REFER & EARN</Text>
          <View style={styles.refCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>YOUR REFERRAL CODE</Text>
              <Text style={styles.refCode}>{ref?.code ?? "—"}</Text>
              <Text style={styles.refMeta}>Share and earn €10 per Pro signup</Text>
            </View>
            <Ionicons name="gift" size={28} color={colors.brand} />
          </View>
        </View>

        <Pressable
          testID="logout-btn"
          style={styles.logoutBtn}
          onPress={logout}
        >
          <Ionicons name="log-out-outline" color={colors.error} size={18} />
          <Text style={styles.logoutTxt}>SIGN OUT</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  hero: { alignItems: "center", paddingVertical: spacing.xl },
  heroAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.brand,
  },
  heroAvatarTxt: { color: colors.brand, fontSize: 32, fontWeight: "900" },
  heroName: { color: colors.text, fontSize: 20, fontWeight: "800", marginTop: spacing.md },
  heroRole: {
    color: colors.brand,
    letterSpacing: 2,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: spacing.md,
  },
  planCard: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  planCardActive: { borderColor: colors.brand },
  planHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  planName: { color: colors.text, fontWeight: "900", letterSpacing: 2 },
  planBadge: {
    backgroundColor: colors.brand,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  planBadgeTxt: { color: colors.brandOn, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  planPrice: { color: colors.brand, fontSize: 20, fontWeight: "900", marginTop: 4 },
  planFeature: { color: colors.textMuted, fontSize: 13 },
  refCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  refLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  refCode: { color: colors.brand, fontSize: 22, fontWeight: "900", letterSpacing: 3, marginTop: 4 },
  refMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
  },
  logoutTxt: { color: colors.error, fontWeight: "900", letterSpacing: 2 },
});
