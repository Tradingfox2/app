import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { api, type AccountingBucket, type AccountingCounts, type AccountingLine, type AccountingSummary } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const DAYS = [7, 30, 90] as const;
type Days = (typeof DAYS)[number];
/** Same minor-unit exponents as `revenuecat._EXPONENT`. Unknown codes use cents. JPY stays in yen. */
const EXPONENT: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, JPY: 0, KMF: 0, KRW: 0,
  MGA: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XPF: 0,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
};
const KINDS: Record<string, string> = {
  checkout: "Checkout", billing_event: "Billing event", partner_ledger: "Coach ledger",
  commission: "Commission", referral: "Referral", subscription: "Subscription",
  store_subscription: "Store subscription",
};
const PROVIDERS = [
  ["stripe", "Subscriptions on file — Stripe (web)"],
  ["revenuecat", "Subscriptions on file — App Store and Google Play"],
] as const;
const PLANS = [
  ["pro_monthly", "Monthly"],
  ["pro_yearly", "Yearly"],
  ["other", "Other plan"],
] as const;
const MONEY = [
  ["gross_collected", "Gross collected"],
  ["platform_fees", "Platform fees"],
  ["owed_to_coaches", "Owed to coaches"],
  ["refunds", "Refunds"],
  ["chargebacks", "Chargebacks"],
] as const;

function periodFor(days: Days): { from: string; to: string } {
  const end = new Date();
  const endUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const start = new Date(endUtc);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { from: start.toISOString().slice(0, 10), to: endUtc.toISOString().slice(0, 10) };
}

const MISSING_BUCKET: AccountingBucket = { state: "unavailable" };

function asBucket(value: unknown): AccountingBucket {
  if (!value || typeof value !== "object") return MISSING_BUCKET;
  const state = (value as { state?: unknown }).state;
  if (state === "none_in_period" || state === "unavailable" || state === "recorded") return value as AccountingBucket;
  return MISSING_BUCKET;
}

function asCounts(value: unknown): AccountingCounts {
  if (!value || typeof value !== "object") return { state: "unavailable" };
  const state = (value as { state?: unknown }).state;
  if (state === "none_in_period" || state === "unavailable" || state === "recorded") return value as AccountingCounts;
  return { state: "unavailable" };
}

function periodLabel(days: Days): string {
  switch (days) {
    case 7: return "Last 7 days";
    case 30: return "Last 30 days";
    case 90: return "Last 90 days";
    default: {
      const exhaustive: never = days;
      return exhaustive;
    }
  }
}

/** Mounted only after the Accounting tab is chosen, so this route is not on first paint. */
export function AccountingPanel() {
  const { t, formatNumber, formatDate } = useI18n();
  const [days, setDays] = useState<Days>(30);
  const [data, setData] = useState<AccountingSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setError("");
    const period = periodFor(days);
    try {
      const next = await api.adminAccounting(period.from, period.to);
      if (id !== requestId.current) return;
      setData(next);
    } catch (cause) {
      if (id !== requestId.current) return;
      setData(null);
      setError(cause instanceof Error ? cause.message : t("Could not load accounting"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [days, t]);
  useEffect(() => { void load(); }, [load]);

  const moneyText = (cents: number, currency: string | null) => {
    const digits = currency ? EXPONENT[currency.toUpperCase()] ?? 2 : 0;
    const major = digits === 0 ? cents : cents / 10 ** digits;
    if (!currency) return `${formatNumber(cents)} · ${t("Currency not recorded")}`;
    const options: Intl.NumberFormatOptions = { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits };
    try {
      return formatNumber(major, options);
    } catch {
      return `${formatNumber(major, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
    }
  };
  const empty = (state: "none_in_period" | "unavailable", none = "Nothing in this period.") => (
    <Text style={styles.hint}>{t(state === "none_in_period" ? none : "Could not read this section.")}</Text>
  );
  const bucket = (section: AccountingBucket, none?: string) => {
    switch (section.state) {
      case "none_in_period":
      case "unavailable":
        return empty(section.state, none);
      case "recorded":
        if (!section.amounts_stored) return <Text style={styles.hint}>{t("Amounts are not stored on these rows.")}</Text>;
        return <>{section.totals.map(row => <Text key={row.currency ?? "unrecorded"} style={styles.figure}>{moneyText(row.amount_cents, row.currency)}</Text>)}</>;
      default: {
        const exhaustive: never = section;
        return exhaustive;
      }
    }
  };
  const counts = (section: AccountingCounts) => {
    switch (section.state) {
      case "none_in_period":
      case "unavailable":
        return empty(section.state);
      case "recorded":
        return <>{section.counts.map(row => (
          <Text key={row.currency ?? "unrecorded"} style={styles.figure}>{formatNumber(row.count)} · {row.currency ?? t("Currency not recorded")}</Text>
        ))}</>;
      default: {
        const exhaustive: never = section;
        return exhaustive;
      }
    }
  };
  const lineAmount = (line: AccountingLine) => (typeof line.cents === "number" ? moneyText(line.cents, line.currency) : t("Amount not recorded"));
  const sections = data?.sections;
  const subscriptionAmounts = sections?.subscription_amounts;
  const nested: { label: string; section: AccountingBucket; testID?: string }[] = data ? [
    { label: "Commissions pending", section: asBucket(sections?.commissions?.pending) },
    { label: "Commissions paid", section: asBucket(sections?.commissions?.paid) },
    { label: "Commissions clawed back", section: asBucket(sections?.commissions?.clawed_back), testID: "accounting-section-commissions-clawed_back" },
    { label: "Referral rewards pending", section: asBucket(sections?.referrals?.pending) },
    { label: "Referral rewards paid", section: asBucket(sections?.referrals?.paid) },
  ] : [];

  return (
    <View testID="accounting-panel">
      <Text style={styles.section}>{t("ACCOUNTING")}</Text>
      <Text style={styles.hint}>{t("Money recorded by Stripe and RevenueCat. Amounts stay in the currency they were charged. Nothing here is converted.")}</Text>
      <View style={styles.filters}>
        {DAYS.map(item => (
          <Pressable key={item} accessibilityRole="button" testID={`accounting-period-${item}`} onPress={() => { if (item === days) return; setDays(item); setLoading(true); }} style={[styles.chip, days === item && styles.chipActive]}>
            <Text style={[styles.chipText, days === item && styles.chipTextActive]}>{t(periodLabel(item))}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? <ActivityIndicator color={colors.text} /> : null}
      {error ? (
        <View accessibilityRole="alert">
          <Text style={styles.error}>{error}</Text>
          <Pressable accessibilityRole="button" testID="accounting-retry" onPress={() => { setLoading(true); void load(); }} style={styles.action}>
            <Text style={styles.actionText}>{t("Retry")}</Text>
          </Pressable>
        </View>
      ) : null}
      {data ? (
        <>
          <Text style={styles.hint}>{data.period.from} – {data.period.to}</Text>
          {MONEY.map(([id, label]) => (
            <View key={id} testID={`accounting-section-${id}`}>
              <Text style={styles.section}>{t(label)}</Text>
              {bucket(asBucket(sections?.[id]))}
            </View>
          ))}
          <Text style={styles.hint}>{t("Last amount on file. Monthly and yearly are never added together.")}</Text>
          {!subscriptionAmounts ? (
            <Text style={styles.hint} testID="accounting-subscriptions-incomplete">{t("Subscription amounts were not in this response. Those rows are incomplete, not zero.")}</Text>
          ) : null}
          {PROVIDERS.map(([provider, label]) => (
            <View key={provider}>
              <Text style={styles.section}>{t(label)}</Text>
              {PLANS.map(([plan, planLabel]) => (
                <View key={plan} testID={`accounting-section-subscription-${provider}-${plan}`}>
                  <Text style={styles.name}>{t(planLabel)}</Text>
                  {bucket(asBucket(subscriptionAmounts?.[provider]?.[plan]))}
                </View>
              ))}
            </View>
          ))}
          <View testID="accounting-section-gym_partner_plans">
            <Text style={styles.section}>{t("Gym partner plans")}</Text>
            <Text style={styles.hint}>{t("Last Stripe amount stored on the gym. Not limited to this period.")}</Text>
            {bucket(asBucket(sections?.gym_partner_plans), "No gym plan amount is stored.")}
          </View>
          {nested.map(item => (
            <View key={item.label} testID={item.testID}><Text style={styles.section}>{t(item.label)}</Text>{bucket(item.section)}</View>
          ))}
          <Text style={styles.section}>{t("Active subscriptions")}</Text>
          {counts(asCounts(sections?.active_subscriptions))}
          <Text style={styles.section}>{t("Recent lines")}</Text>
          {data.recent_lines.length === 0 ? <Text style={styles.hint}>{t("Nothing in this period.")}</Text> : null}
          {data.recent_lines.map((line, index) => (
            <View key={`${line.kind}-${line.stripe_id ?? "none"}-${line.when ?? index}`} style={styles.row} testID="accounting-line">
              <Text style={styles.name}>{t(KINDS[line.kind] ?? line.kind)}{line.status ? ` · ${line.status}` : ""}</Text>
              <Text style={styles.meta}>{line.stripe_id ?? t("Not recorded")} · {lineAmount(line)}</Text>
              <Text style={styles.meta}>{line.when ? formatDate(line.when, { dateStyle: "short", timeStyle: "short" }) : t("Date not recorded")}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { ...type.section, marginTop: spacing.lg },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  figure: { color: colors.text, fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"], marginTop: spacing.xs },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  chipActive: { borderColor: colors.text, backgroundColor: colors.surface2 },
  chipText: { color: colors.textDim, fontSize: 11, fontWeight: "800" },
  chipTextActive: { color: colors.text },
  row: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { color: colors.text, fontSize: 13, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  action: { minHeight: 40, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, marginTop: spacing.sm },
  actionText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  error: { color: colors.error, marginTop: spacing.sm },
});
