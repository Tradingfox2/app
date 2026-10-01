import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useAuth } from "@/src/auth-context";
import { api, type AccountingBucket, type ProPlanPrice, type ReferralSummary, type SupportedLocale } from "@/src/api";
import { buildJoinUrl, shareLink } from "@/src/share";
import { card, colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { Avatar } from "@/src/components/social/avatar";

const PLANS: { key: string; name: string; price: string; features: string[] }[] = [
  { key: "free", name: "FREE", price: "€0", features: ["Workout tracker", "50 exercises", "Community feed"] },
  { key: "pro", name: "PRO", price: "", features: ["Biomarker uploads", "Wearable sync", "AI insights"] },
  { key: "elite", name: "ELITE", price: "€29 / mo", features: ["1:1 coach", "Group sessions", "Priority support"] },
];

const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

function formatMinor(amount: number, currency: string, locale: string): string {
  const code = currency.trim();
  if (!code) return String(amount);
  const major = ZERO_DECIMAL.has(code.toLowerCase()) ? amount : amount / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code.toUpperCase() }).format(major);
  } catch {
    return `${amount} ${code.toUpperCase()}`;
  }
}

function rewardText(section: AccountingBucket, translate: (source: string) => string, locale: string): string {
  switch (section.state) {
    case "none_in_period":
      return translate("Nothing earned yet.");
    case "unavailable":
      return translate("Could not read this section.");
    case "recorded":
      if (!section.amounts_stored) return translate("Amounts are not stored on these rows.");
      return section.totals.map((row) => (
        row.currency
          ? formatMinor(row.amount_cents, row.currency, locale)
          : `${row.amount_cents} · ${translate("Currency not recorded")}`
      )).join(" · ");
    default: {
      const unreachable: never = section;
      return unreachable;
    }
  }
}

function isPro(plan: string | undefined): boolean {
  return plan === "pro" || plan === "pro_monthly" || plan === "pro_yearly";
}

const LANGUAGES: { code: SupportedLocale; label: string }[] = [
  { code: "fr", label: "FRANÇAIS" },
  { code: "en", label: "ENGLISH" },
  { code: "de", label: "DEUTSCH" },
  { code: "es", label: "ESPAÑOL" },
  { code: "it", label: "ITALIANO" },
];

export default function Settings() {
  const { user, logout, refresh } = useAuth();
  const { t, localeTag } = useI18n();
  const router = useRouter();
  const [sub, setSub] = useState<any>(null);
  const [ref, setRef] = useState<ReferralSummary | null>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState("");
  const [planError, setPlanError] = useState("");
  const [prices, setPrices] = useState<ProPlanPrice[] | null>(null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const billingBusy = useRef(false);
  const signingOutRef = useRef(false);
  const rankingBusy = useRef(false);
  const [savingRanking, setSavingRanking] = useState(false);
  const [rankingError, setRankingError] = useState("");
  const [rankingOptIn, setRankingOptIn] = useState(user?.activity_ranking_opt_in ?? false);
  useEffect(() => setRankingOptIn(user?.activity_ranking_opt_in ?? false), [user?.activity_ranking_opt_in]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [isPrivate, setIsPrivate] = useState(user?.is_private ?? false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const privacyBusy = useRef(false);
  useEffect(() => setIsPrivate(user?.is_private ?? false), [user?.is_private]);
  const savePrivacy = async (value: boolean) => {
    if (privacyBusy.current) return;
    privacyBusy.current = true; setSavingPrivacy(true); setRankingError("");
    // Optimistic so the switch does not stutter; reverted if the write fails.
    setIsPrivate(value);
    try { const updated = await api.updatePrivacy(value); setIsPrivate(updated.is_private ?? value); await refresh(); }
    catch { setIsPrivate(!value); setRankingError(t("Something went wrong")); }
    finally { privacyBusy.current = false; setSavingPrivacy(false); }
  };
  // Refreshed on focus so the badge is current after reading the centre.
  // A failure just leaves the badge hidden — it must never break Profile.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    api.unreadNotificationCount()
      .then(result => { if (!cancelled) setUnreadCount(result.count); })
      .catch(() => undefined);
    api.followRequests()
      .then(rows => { if (!cancelled) setRequestCount(rows.length); })
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
    setSub(await api.currentSub().catch(() => ({ plan: "free" })));
  }, []);
  // The referral route is not part of first paint. It runs when the card is opened.
  const loadReferral = async () => {
    if (refLoading) return;
    setRefLoading(true);
    setRefError("");
    try { setRef(await api.referral()); }
    catch (cause) { setRefError(cause instanceof Error ? cause.message : t("Could not load your referral.")); }
    finally { setRefLoading(false); }
  };

  useEffect(() => {
    load();
  }, [load]);

  const selectPlan = async (plan: string) => {
    if (plan === (sub?.plan ?? "free")) return;
    setPlanError("");
    try { await api.setSub(plan); await load(); }
    catch { setPlanError(t("Plan changes require verified billing. No payment was taken.")); }
  };

  const fail = (cause: unknown, fallback: string) => {
    setPlanError(cause instanceof Error ? cause.message : t(fallback));
  };
  const webOnly = () => {
    if (Platform.OS === "web") return false;
    setPlanError(t("Pro is available on the web app."));
    return true;
  };
  const openPortal = async () => {
    if (billingBusy.current || webOnly()) return;
    setPlanError("");
    billingBusy.current = true;
    try {
      const portal = await api.subscriptionPortal();
      if (portal.url) window.location.assign(portal.url);
    } catch (cause) { fail(cause, "Could not open checkout."); }
    finally { billingBusy.current = false; }
  };
  const openPro = async () => {
    setPlanError("");
    if (isPro(sub?.plan) || webOnly() || prices || pricesLoading) return;
    setPricesLoading(true);
    try { setPrices((await api.subscriptionPlans()).plans ?? []); }
    catch (cause) { fail(cause, "Payments are not set up yet."); }
    finally { setPricesLoading(false); }
  };
  const startCheckout = async (plan: ProPlanPrice["plan"]) => {
    if (billingBusy.current) return;
    setPlanError("");
    billingBusy.current = true;
    try {
      const session = await api.subscriptionCheckout(plan);
      if (session.url && Platform.OS === "web") window.location.assign(session.url);
    } catch (cause) { fail(cause, "Could not open checkout."); }
    finally { billingBusy.current = false; }
  };

  const selectLanguage = async (locale: SupportedLocale) => {
    if (savingLanguage || locale === user?.preferred_locale) return;
    setSavingLanguage(true);
    setLanguageError("");
    try {
      await api.updateProfile(locale);
      await refresh();
    } catch (cause) {
      setLanguageError(cause instanceof Error ? cause.message : t("Could not change the language."));
    } finally {
      setSavingLanguage(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="settings-screen">
      <View style={styles.header}>
        <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.headerIcon}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Affordance>
        <Text style={styles.headerTitle}>{t("SETTINGS")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroAvatar}>
            <Avatar user={user ? { full_name: user.full_name ?? user.email, avatar_url: user.avatar_url } : null} size={72} />
          </View>
          <Text style={styles.heroName}>{user?.full_name ?? user?.email}</Text>
          <Text style={styles.heroRole}>{user?.role?.toUpperCase()}</Text>
          {user?.bio ? <Text style={styles.refMeta} testID="my-bio">{user.bio}</Text> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Affordance accessibilityRole="button" testID="edit-profile" onPress={() => router.push("/profile-edit")} style={styles.logoutBtn}>
              <Ionicons name="create-outline" size={16} color={colors.text} /><Text style={[styles.logoutTxt, { color: colors.text }]}>{t("EDIT PROFILE")}</Text>
            </Affordance>
            {user ? <Affordance accessibilityRole="button" testID="view-my-profile" onPress={() => router.push({ pathname: "/user/[id]", params: { id: user.id } })} style={styles.logoutBtn}>
              <Ionicons name="person-outline" size={16} color={colors.text} /><Text style={[styles.logoutTxt, { color: colors.text }]}>{t("VIEW PROFILE")}</Text>
            </Affordance> : null}
            {user ? <Affordance accessibilityRole="button" testID="open-friends-feed" onPress={() => router.push("/friends" as Href)} style={styles.logoutBtn}>
              <Ionicons name="people-outline" size={16} color={colors.text} /><Text style={[styles.logoutTxt, { color: colors.text }]}>{t("FRIENDS")}</Text>
            </Affordance> : null}
          </View>
          <Affordance
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
          </Affordance>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("COACH & COMMUNITY")}</Text>
          <Affordance
            style={styles.refCard}
            onPress={() => router.push((user?.role === "coach" ? "/partner" : "/coach/onboarding") as Href)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t(user?.role === "coach" ? "PARTNER DASHBOARD" : "BECOME A COACH")}</Text>
              <Text style={styles.refMeta}>{t(user?.role === "coach" ? "Manage communities, members, and verified earnings." : "Apply to create communities and paid memberships.")}</Text>
            </View>
            <Ionicons name={user?.role === "coach" ? "analytics" : "ribbon"} size={28} color={colors.text} />
          </Affordance>
          <Affordance testID="open-follow-requests" style={styles.refCard} onPress={() => router.push("/follow-requests")}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("FOLLOW REQUESTS")}</Text>
              <Text style={styles.refMeta}>{t("People asking to follow your private account.")}</Text>
            </View>
            {requestCount > 0 ? <View testID="follow-request-badge" style={styles.badge}><Text style={styles.badgeText}>{requestCount > 99 ? "99+" : requestCount}</Text></View> : null}
            <Ionicons name="person-add" size={28} color={colors.text} />
          </Affordance>
          <Affordance testID="open-notifications" style={styles.refCard} onPress={() => router.push("/notifications")}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("NOTIFICATIONS")}</Text>
              <Text style={styles.refMeta}>{t("Mentions, moderation decisions and lab results.")}</Text>
            </View>
            {unreadCount > 0 ? <View testID="notification-badge" style={styles.badge}><Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text></View> : null}
            <Ionicons name="notifications" size={28} color={colors.text} />
          </Affordance>
          <Affordance testID="open-notification-settings" style={styles.refCard} onPress={() => router.push("/notification-settings")}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("NOTIFICATION SETTINGS")}</Text>
              <Text style={styles.refMeta}>{t("Choose what reaches you, in the app and on your phone.")}</Text>
            </View>
            <Ionicons name="options" size={28} color={colors.text} />
          </Affordance>
          <Affordance testID="open-saved" style={styles.refCard} onPress={() => router.push("/saved")}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("SAVED POSTS")}</Text>
              <Text style={styles.refMeta}>{t("Posts you bookmarked. Only you can see this list.")}</Text>
            </View>
            <Ionicons name="bookmark" size={28} color={colors.text} />
          </Affordance>
          <Affordance testID="open-support" style={styles.refCard} onPress={() => router.push("/support")}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("SUPPORT")}</Text>
              <Text style={styles.refMeta}>{t("Questions about billing, your account, or the app.")}</Text>
            </View>
            <Ionicons name="help-buoy" size={28} color={colors.text} />
          </Affordance>
          {user?.staff_role ? (
            <Affordance testID="open-admin-console" style={styles.refCard} onPress={() => router.push("/admin" as Href)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.refLabel}>{t("STAFF CONSOLE")}</Text>
                <Text style={styles.refMeta}>{t("Moderation queue, accounts and audit log.")}</Text>
              </View>
              <Ionicons name="shield-checkmark" size={28} color={colors.text} />
            </Affordance>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("App language").toUpperCase()}</Text>
          <View style={styles.languageGrid}>
            {LANGUAGES.map((language) => {
              const active = (user?.preferred_locale ?? "fr") === language.code;
              return (
                <Affordance
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
                  {active ? <Ionicons name="checkmark" size={14} color={colors.text} /> : null}
                </Affordance>
              );
            })}
          </View>
          <Text style={styles.languageHint}>{t("Changes the entire app and new AI-generated content.")}</Text>
          {languageError ? <Text accessibilityRole="alert" testID="language-error" style={styles.languageError}>{languageError}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("ACTIVITY PRIVACY")}</Text>
          <View style={styles.refCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("Appear in activity rankings")}</Text>
              <Text style={styles.refMeta}>{t("Publishes your name and active-day count from opted-in public channels. Off by default; opt out anytime.")}</Text>
            </View>
            <Switch testID="activity-ranking-consent" accessibilityLabel={t("Appear in activity rankings")} value={rankingOptIn} disabled={savingRanking} onValueChange={value => void saveRanking(value)} trackColor={{ true: colors.text }} />
          </View>
          <View style={styles.refCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>{t("Private account")}</Text>
              <Text style={styles.refMeta}>{t("New followers have to be approved, and only approved followers see your posts.")}</Text>
            </View>
            <Switch testID="private-account-toggle" accessibilityLabel={t("Private account")} value={isPrivate} disabled={savingPrivacy} onValueChange={value => void savePrivacy(value)} trackColor={{ true: colors.text }} />
          </View>
          {rankingError ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{rankingError}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("SUBSCRIPTION")}</Text>
          {planError ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{planError}</Text> : null}
          {PLANS.map((p) => {
            const active = p.key === "pro" ? isPro(sub?.plan) : (sub?.plan ?? "free") === p.key;
            return (
              <View key={p.key}>
                <Affordance
                  testID={`plan-${p.key}-btn`}
                  onPress={() => { if (p.key === "pro") void openPro(); else void selectPlan(p.key); }}
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
                    {p.price ? <Text style={styles.planPrice}>{p.price}</Text> : null}
                    <View style={{ marginTop: spacing.sm, gap: 4 }}>
                      {p.features.map((f) => (
                        <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Ionicons name="checkmark" size={12} color={colors.text} />
                          <Text style={styles.planFeature}>{t(f)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </Affordance>
                {p.key === "pro" && isPro(sub?.plan) ? (
                  <Affordance testID="plan-manage-btn" onPress={() => void openPortal()} style={styles.planCard}>
                    <Text style={styles.planName}>{t("MANAGE BILLING")}</Text>
                  </Affordance>
                ) : null}
                {p.key === "pro" && pricesLoading ? <Text style={styles.languageHint}>{t("Loading prices…")}</Text> : null}
                {p.key === "pro" && prices?.map((price) => (
                  <Affordance key={price.plan} testID={price.plan === "pro_yearly" ? "plan-pro-yearly" : "plan-pro-monthly"} onPress={() => void startCheckout(price.plan)} style={styles.planCard}>
                    <Text style={styles.planName}>{price.interval === "year" ? t("YEARLY") : t("MONTHLY")}</Text>
                    <Text style={styles.planPrice}>{formatMinor(price.amount_cents, price.currency, localeTag)}</Text>
                    {price.interval === "year" ? <Text style={styles.planFeature}>{t("7-day free trial")}</Text> : null}
                  </Affordance>
                ))}
              </View>
            );
          })}
        </View>

        <View style={styles.section} testID="referral-card">
          <Text style={styles.sectionTitle}>{t("REFER & EARN")}</Text>
          {!ref ? (
            <Affordance testID="referral-load" accessibilityRole="button" onPress={() => void loadReferral()} style={styles.refCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.planName}>{refLoading ? t("LOADING REFERRAL…") : t("SEE MY REFERRAL")}</Text>
                <Text style={styles.refMeta}>{t("Share your code. Rewards appear after verified conversions.")}</Text>
                {refError ? <Text style={styles.languageError}>{refError}</Text> : null}
              </View>
              <Ionicons name="gift" size={28} color={colors.text} />
            </Affordance>
          ) : (
            <View style={styles.refCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.refLabel}>{t("YOUR REFERRAL CODE")}</Text>
                <Text style={styles.refCode}>{ref.code}</Text>
                <Text style={styles.refMeta} testID="referral-link">{buildJoinUrl(ref.code)}</Text>
                <Text style={styles.refMeta}>{t("People you referred")}: {ref.counts.referred}</Text>
                <Text style={styles.refMeta}>{t("Paid conversions")}: {ref.counts.converted}</Text>
                <Text style={styles.refMeta}>{t("Pending reward")}: {rewardText(ref.pending, t, localeTag)}</Text>
                <Text style={styles.refMeta}>{t("Paid reward")}: {rewardText(ref.paid, t, localeTag)}</Text>
                <Affordance testID="referral-share" accessibilityRole="button" onPress={() => { void shareLink(buildJoinUrl(ref.code)); }} style={{ marginTop: spacing.sm }}>
                  <Text style={styles.planName}>{t("SHARE")}</Text>
                </Affordance>
              </View>
            </View>
          )}
        </View>

        <Affordance
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
        </Affordance>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.section, color: colors.text, flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  hero: { alignItems: "center", paddingVertical: spacing.xl },
  heroAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.text,
  },
  heroAvatarTxt: { color: colors.text, fontSize: 32, fontWeight: "900" },
  heroName: { ...type.screenTitle, fontSize: 24, marginTop: spacing.md },
  heroRole: {
    color: colors.text,
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
  languageOptionActive: { backgroundColor: colors.surface2, borderColor: colors.border },
  languageText: { color: colors.textMuted, fontSize: 13, fontWeight: "400" },
  languageTextActive: { color: colors.text, fontWeight: "600" },
  languageHint: { color: colors.textDim, fontSize: 11, marginTop: spacing.sm },
  languageError: { color: colors.error, fontSize: 12, marginTop: spacing.sm },
  planCard: {
    ...card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  planCardActive: { borderColor: colors.text },
  planHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  planName: { color: colors.text, fontWeight: "900", letterSpacing: 2 },
  planBadge: {
    backgroundColor: colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  planBadgeTxt: { color: colors.text, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  planPrice: {
    color: colors.text,
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
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.text, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.bg, fontSize: 11, fontWeight: "900" },
  refLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  refCode: { color: colors.text, fontSize: 22, fontWeight: "900", letterSpacing: 3, marginTop: 4 },
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
