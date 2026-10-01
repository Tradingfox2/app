import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, PartnerDashboard } from "@/src/api";
import { METRIC_GLOSSARY } from "@/src/analytics-locales";
import { MetricGlossary } from "@/src/components/metric-glossary";
import { colors, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { joinPolicyPhrase } from "@/src/community-copy";

export default function PartnerDashboardScreen() {
  const { t, formatNumber, localeTag } = useI18n(); const router = useRouter();
  const params = useLocalSearchParams<{ connect?: string | string[] }>();
  const returned = (Array.isArray(params.connect) ? params.connect[0] : params.connect) === "return";
  const [data, setData] = useState<PartnerDashboard | null>(null); const [error, setError] = useState("");
  const [country, setCountry] = useState(""); const [connectError, setConnectError] = useState("");
  const load = useCallback(() => { void api.partnerDashboard().then(setData).catch(cause => setError(cause instanceof Error ? cause.message : t("Could not load dashboard"))); }, [t]);
  useEffect(load, [load]);
  // Stripe sends the coach back here. Home and a normal open of this screen do not call Connect.
  useEffect(() => {
    if (!returned) return;
    void api.connectStatus().then(() => load()).catch(() => undefined);
  }, [returned, load]);
  const connect = () => {
    setConnectError("");
    void api.connectPayouts(country.trim().toUpperCase())
      .then(result => Linking.openURL(result.url))
      .catch(cause => setConnectError(cause instanceof Error ? cause.message : t("Could not open payout setup")));
  };
  const needsPayouts = data != null && data.payout_status !== "connected";
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Affordance onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance><Text style={styles.headerTitle}>{t("PARTNER DASHBOARD")}</Text><Affordance onPress={() => router.push("/community/new")} style={styles.icon}><Ionicons name="add" size={22} color={colors.text} /></Affordance></View>
    {!data && !error ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xxxl }} /> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {data ? <ScrollView contentContainerStyle={styles.scroll}><Text style={styles.eyebrow}>{t("NETWORK PULSE")}</Text><Text style={styles.title}>{t("Your coaching business")}</Text>
      <View style={styles.metrics}>
        <MetricGlossary testID="partner-metric-active-members" value={formatNumber(data.active_members)} label={t("ACTIVE MEMBERS")} glossary={t(METRIC_GLOSSARY.active_members)} style={styles.metric} valueStyle={styles.metricValue} labelStyle={styles.metricLabel} />
        <MetricGlossary testID="partner-metric-pending" value={formatNumber(data.pending_members)} label={t("PENDING")} glossary={t(METRIC_GLOSSARY.pending_members)} style={styles.metric} valueStyle={styles.metricValue} labelStyle={styles.metricLabel} />
        <MetricGlossary testID="partner-metric-communities" value={formatNumber(data.community_count)} label={t("COMMUNITIES")} glossary={t(METRIC_GLOSSARY.community_count)} style={styles.metric} valueStyle={styles.metricValue} labelStyle={styles.metricLabel} />
      </View>
      {needsPayouts ? <View style={styles.banner} testID="connect-payouts-banner"><Text style={styles.bannerText}>{t("You must connect payouts to receive money.")}</Text><TextInput value={country} onChangeText={setCountry} autoCapitalize="characters" maxLength={2} placeholder={t("ISO country code")} placeholderTextColor={colors.textDim} style={styles.country} testID="connect-country" /><Affordance accessibilityRole="button" testID="connect-payouts" onPress={connect} style={styles.connectBtn}><Text style={styles.connectBtnText}>{t("CONNECT PAYOUTS")}</Text></Affordance>{connectError ? <Text style={styles.error}>{connectError}</Text> : null}</View> : null}
      <View style={styles.moneyBand}><View><Text style={styles.moneyLabel}>{t("AVAILABLE BALANCE")}</Text><Text style={styles.money}>{data.balances.length ? data.balances.map(row => new Intl.NumberFormat(localeTag, { style: "currency", currency: row._id }).format(row.net_cents / 100)).join(" · ") : "—"}</Text></View><View style={styles.payout}><Ionicons name="wallet-outline" size={17} color={colors.warning} /><Text style={styles.payoutText}>{t(data.payout_status.toUpperCase())}</Text></View></View>
      <Text style={styles.section}>{t("YOUR COMMUNITIES")}</Text>{data.communities.map(item => <Affordance key={item.id} onPress={() => router.push({ pathname: "/community/[id]", params: { id: item.id } })} style={styles.row}><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowMeta}>{formatNumber(item.member_count)} {t("members")} · {t(joinPolicyPhrase(item.join_policy))}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textDim} /></Affordance>)}
    </ScrollView> : null}
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text, flex: 1 }, scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl }, eyebrow: { ...type.eyebrow, color: colors.text }, title: { ...type.screenTitle, marginTop: 4 }, metrics: { flexDirection: "row", marginTop: spacing.xl, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }, metric: { flex: 1, minHeight: 96, justifyContent: "center", borderRightWidth: 1, borderRightColor: colors.border, paddingHorizontal: spacing.sm }, metricValue: { color: colors.text, fontSize: 26, fontWeight: "900", fontVariant: ["tabular-nums"] }, metricLabel: { color: colors.textMuted, fontSize: 9, fontWeight: "800", marginTop: 4 }, banner: { marginTop: spacing.xl, padding: spacing.lg, backgroundColor: colors.warningWash, borderLeftWidth: 3, borderLeftColor: colors.warning }, bannerText: { color: colors.text, fontSize: 14, fontWeight: "700" }, country: { marginTop: spacing.md, minHeight: 44, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, paddingHorizontal: spacing.md }, connectBtn: { marginTop: spacing.md, minHeight: 44, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, connectBtnText: { color: colors.brandOn, fontSize: 12, fontWeight: "900" }, moneyBand: { marginTop: spacing.xl, padding: spacing.lg, backgroundColor: colors.surface2, borderLeftWidth: 3, borderLeftColor: colors.warning, flexDirection: "row", alignItems: "center" }, moneyLabel: { ...type.eyebrow }, money: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 4 }, payout: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 5 }, payoutText: { color: colors.warning, fontSize: 9, fontWeight: "900" }, section: { ...type.section, marginTop: spacing.xxl, marginBottom: spacing.sm }, row: { minHeight: 72, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border }, rowTitle: { color: colors.text, fontWeight: "800" }, rowMeta: { color: colors.textMuted, fontSize: 11, marginTop: 4 }, error: { color: colors.error, padding: spacing.lg } });
