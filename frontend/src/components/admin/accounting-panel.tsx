import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { api, type AccountingBucket, type AccountingCounts, type AccountingLine, type AccountingSummary } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const DAYS = [7, 30, 90] as const;
type Days = (typeof DAYS)[number];
const KINDS: Record<string, string> = {
  checkout: "Checkout", billing_event: "Billing event", partner_ledger: "Coach ledger",
  commission: "Commission", referral: "Referral", subscription: "Subscription",
};
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
  const load = useCallback(async () => {
    setError("");
    const period = periodFor(days);
    try {
      setData(await api.adminAccounting(period.from, period.to));
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : t("Could not load accounting"));
    } finally {
      setLoading(false);
    }
  }, [days, t]);
  useEffect(() => { void load(); }, [load]);

  const moneyText = (cents: number, currency: string | null) => {
    if (!currency) return `${formatNumber(cents / 100)} · ${t("Currency not recorded")}`;
    try {
      return formatNumber(cents / 100, { style: "currency", currency });
    } catch {
      return `${formatNumber(cents / 100)} ${currency}`;
    }
  };
  const empty = (state: "none_in_period" | "unavailable") => (
    <Text style={styles.hint}>{t(state === "none_in_period" ? "Nothing in this period." : "Could not read this section.")}</Text>
  );
  const bucket = (section: AccountingBucket) => {
    switch (section.state) {
      case "none_in_period":
      case "unavailable":
        return empty(section.state);
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
  const nested: { label: string; section: AccountingBucket }[] = data ? [
    { label: "Commissions pending", section: data.sections.commissions.pending },
    { label: "Commissions paid", section: data.sections.commissions.paid },
    { label: "Referral rewards pending", section: data.sections.referrals.pending },
    { label: "Referral rewards paid", section: data.sections.referrals.paid },
  ] : [];

  return (
    <View testID="accounting-panel">
      <Text style={styles.section}>{t("ACCOUNTING")}</Text>
      <Text style={styles.hint}>{t("Money recorded in Stripe. Amounts stay in the currency they were charged. Nothing here is converted.")}</Text>
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
              {bucket(data.sections[id])}
            </View>
          ))}
          {nested.map(item => (
            <View key={item.label}><Text style={styles.section}>{t(item.label)}</Text>{bucket(item.section)}</View>
          ))}
          <Text style={styles.section}>{t("Active subscriptions")}</Text>
          {counts(data.sections.active_subscriptions)}
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
