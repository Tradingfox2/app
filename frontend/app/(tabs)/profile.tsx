import { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useAuth } from "@/src/auth-context";
import { api, type SupportedLocale } from "@/src/api";
import { card, colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const PLANS: { key: string; name: string; price: string; features: string[] }[] = [
  { key: "free", name: "FREE", price: "€0", features: ["Workout tracker", "50 exercises", "Community feed"] },
  { key: "pro", name: "PRO", price: "€9.90 / mo", features: ["Biomarker uploads", "Wearable sync", "AI insights"] },
  { key: "elite", name: "ELITE", price: "€29 / mo", features: ["1:1 coach", "Group sessions", "Priority support"] },
];

const LANGUAGES: { code: SupportedLocale; label: string }[] = [
  { code: "fr", label: "FRANÇAIS" },
  { code: "en", label: "ENGLISH" },
  { code: "de", label: "DEUTSCH" },
  { code: "es", label: "ESPAÑOL" },
  { code: "it", label: "ITALIANO" },
];

export default function Profile() {
  const { user, logout, refresh } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [sub, setSub] = useState<any>(null);
  const [ref, setRef] = useState<any>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [planError, setPlanError] = useState("");
  const signingOutRef = useRef(false);
  const rankingBusy = useRef(false);
  const [savingRanking, setSavingRanking] = useState(false);
  const [rankingError, setRankingError] = useState("");
  const [rankingOptIn, setRankingOptIn] = useState(user?.activity_ranking_opt_in ?? false);
  useEffect(() => setRankingOptIn(user?.activity_ranking_opt_in ?? false), [user?.activity_ranking_opt_in]);
  const [unreadCount, setUnreadCount] = useState(0);
  // Refreshed on focus so the badge is current after reading the centre.
  // A failure just leaves the badge hidden — it must never break Profile.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    api.unreadNotificationCount()
      .then(result => { if (!cancelled) setUnreadCount(result.count); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []));
  const saveRanking = async (value: boolean) => {
    if (rankingBusy.current) return;
    rankingBusy.current = true; setSavingRanking(true); setRankingError("");
    try {
      const updated = await api.updateRankingPreference(value);
      setRankingOptIn(updated.activity_ranking_opt_in ?? false);
      await refresh();
    } catch { setRankingError(t("Something went wrong")); }
    finally { rankingBusy.current = false; setSavingRanking(false); }
  };

  const handleSignOut = useCallback(() => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    void logout()
      .then(() => {
        router.replace("/auth");
      })
      .catch(() => {
        signingOutRef.current = false;
        setSigningOut(false);
      });
  }, [logout, router]);

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
    if (plan === (sub?.plan ?? "free")) return;
    setPlanError("");
    try { await api.setSub(plan); await load(); }
    catch { setPlanError(t("Plan changes require verified billing. No payment was taken.")); }
  };

  const selectLanguage = async (locale: SupportedLocale) => {
    if (savingLanguage || locale === user?.preferred_locale) return;
    setSavingLanguage(true);
    try {
      await api.updateProfile(locale);
      await refresh();
    } finally {
      setSavingLanguage(false);
    }
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
          <Pressable
            testID="logout-btn"
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            pointerEvents="box-only"
            disabled={signingOut}
            onPress={handleSignOut}
            {...(Platform.OS === "web"
              ? {
                  onClick: (event: { preventDefault?: () => void }) => {
                    event?.preventDefault?.();
                    handleSignOut();
                  },
                  role: "button",
                  tabIndex: 0,
                }
              : {})}
            style={[styles.logoutBtn, styles.logoutBtnHero, signingOut && { opacity: 0.5 }]}
          >
            <Ionicons
              name="log-out-outline"
              color={colors.error}
              size={18}
              pointerEvents="none"
            />
            <Text style={styles.logoutTxt} pointerEvents="none">
              {signingOut ? t("SIGNING OUT…") : t("SIGN OUT")}
            </Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("COACH & COMMUNITY")}</Text>
          <Pressable
            style={styles.refCard}
            onPress={() => router.push((user?.role === "coach" ? "/partner" : "/coach/onboarding") as Href)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t(user?.role === "coach" ? "PARTNER DASHBOARD" : "BECOME A COACH")}</Text>
              <Text style={styles.refMeta}>{t(user?.role === "coach" ? "Manage communities, members, and verified earnings." : "Apply to create communities and paid memberships.")}</Text>
            </View>
            <Ionicons name={user?.role === "coach" ? "analytics" : "ribbon"} size={28} color={colors.brand} />
          </Pressable>
          <Pressable testID="open-notifications" style={styles.refCard} onPress={() => router.push("/notifications")}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("NOTIFICATIONS")}</Text>
              <Text style={styles.refMeta}>{t("Mentions, moderation decisions and lab results.")}</Text>
            </View>
            {unreadCount > 0 ? <View testID="notification-badge" style={styles.badge}><Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text></View> : null}
            <Ionicons name="notifications" size={28} color={colors.brand} />
          </Pressable>
          {user?.staff_role ? (
            <Pressable testID="open-admin-console" style={styles.refCard} onPress={() => router.push("/admin" as Href)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.refLabel}>{t("STAFF CONSOLE")}</Text>
                <Text style={styles.refMeta}>{t("Moderation queue, accounts and audit log.")}</Text>
              </View>
              <Ionicons name="shield-checkmark" size={28} color={colors.brand} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("App language").toUpperCase()}</Text>
          <View style={styles.languageGrid}>
            {LANGUAGES.map((language) => {
              const active = (user?.preferred_locale ?? "fr") === language.code;
              return (
                <Pressable
                  key={language.code}
                  testID={`language-${language.code}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: savingLanguage }}
                  disabled={savingLanguage}
                  onPress={() => selectLanguage(language.code)}
                  style={[styles.languageOption, active && styles.languageOptionActive]}
                >
                  <Text style={[styles.languageText, active && styles.languageTextActive]}>
                    {language.label}
                  </Text>
                  {active ? <Ionicons name="checkmark" size={14} color={colors.brandOn} /> : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.languageHint}>{t("Changes the entire app and new AI-generated content.")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("ACTIVITY PRIVACY")}</Text>
          <View style={styles.refCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("Appear in activity rankings")}</Text>
              <Text style={styles.refMeta}>{t("Publishes your name and active-day count from opted-in public channels. Off by default; opt out anytime.")}</Text>
            </View>
            <Switch testID="activity-ranking-consent" accessibilityLabel={t("Appear in activity rankings")} value={rankingOptIn} disabled={savingRanking} onValueChange={value => void saveRanking(value)} trackColor={{ true: colors.brand }} />
          </View>
          {rankingError ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{rankingError}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("SUBSCRIPTION")}</Text>
          <Text style={styles.languageHint}>{t("Plan changes require verified billing. No payment was taken.")}</Text>
          {planError ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{planError}</Text> : null}
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
                        <Text style={styles.planBadgeTxt}>{t("CURRENT")}</Text>
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
                        <Text style={styles.planFeature}>{t(f)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("REFER & EARN")}</Text>
          <View style={styles.refCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("YOUR REFERRAL CODE")}</Text>
              <Text style={styles.refCode}>{ref?.code ?? "—"}</Text>
              <Text style={styles.refMeta}>{t("Share your code. Rewards appear after verified conversions.")}</Text>
            </View>
            <Ionicons name="gift" size={28} color={colors.brand} />
          </View>
        </View>

        <Pressable
          testID="logout-btn-bottom"
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          pointerEvents="box-only"
          disabled={signingOut}
          onPress={handleSignOut}
          {...(Platform.OS === "web"
            ? {
                onClick: (event: { preventDefault?: () => void }) => {
                  event?.preventDefault?.();
                  handleSignOut();
                },
                role: "button",
                tabIndex: 0,
              }
            : {})}
          style={[styles.logoutBtn, signingOut && { opacity: 0.5 }]}
        >
          <Ionicons
            name="log-out-outline"
            color={colors.error}
            size={18}
            pointerEvents="none"
          />
          <Text style={styles.logoutTxt} pointerEvents="none">
            {signingOut ? t("SIGNING OUT…") : t("SIGN OUT")}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
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
  heroName: { ...type.screenTitle, fontSize: 24, marginTop: spacing.md },
  heroRole: {
    color: colors.brand,
    letterSpacing: 2,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    ...type.section,
    marginBottom: spacing.md,
  },
  languageGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  languageOption: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
  },
  languageOptionActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  languageText: { color: colors.textMuted, fontSize: 10, fontWeight: "800" },
  languageTextActive: { color: colors.brandOn },
  languageHint: { color: colors.textDim, fontSize: 11, marginTop: spacing.sm },
  planCard: {
    ...card,
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
  planPrice: {
    color: colors.brand,
    fontSize: 22,
    fontWeight: "800",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  planFeature: { color: colors.textMuted, fontSize: 13 },
  refCard: {
    flexDirection: "row",
    alignItems: "center",
    ...card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.brandOn, fontSize: 11, fontWeight: "900" },
  refLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  refCode: { color: colors.brand, fontSize: 22, fontWeight: "900", letterSpacing: 3, marginTop: 4 },
  refMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    cursor: "pointer",
    zIndex: 2,
  },
  logoutBtnHero: {
    marginTop: spacing.lg,
    alignSelf: "center",
    minWidth: 180,
  },
  logoutTxt: { color: colors.error, fontWeight: "900", letterSpacing: 2 },
});
