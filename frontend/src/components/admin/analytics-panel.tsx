import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { api, type AnalyticsSummary } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const LABELS: Record<string, string> = {
  screen_view: "Screen views",
  ticket_created: "Tickets created",
  ticket_replied: "Ticket replies",
  post_created: "Posts created",
  post_shared: "Posts shared",
  live_session_started: "Live sessions started",
  live_session_joined: "Live sessions joined",
};

/**
 * Staff rollup. Names and numbers are the `GET /admin/analytics` payload.
 * A name is drawn only when that window returns a number.
 */
export function AnalyticsPanel() {
  const { t, formatNumber } = useI18n();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api.adminAnalytics());
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : t("Could not load analytics"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const names = data ? Object.keys(data.windows["24h"]) : [];

  return (
    <View testID="analytics-panel">
      <Text style={styles.section}>{t("Product events")}</Text>
      <Text style={styles.hint}>{t("Counts are read from stored events. Nothing on this page is estimated.")}</Text>
      <Pressable accessibilityRole="button" testID="analytics-refresh" onPress={() => { setLoading(true); void load(); }} style={styles.action}>
        <Text style={styles.actionText}>{t("Refresh counts")}</Text>
      </Pressable>
      {loading ? <ActivityIndicator color={colors.brand} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {data ? (
        <>
          <Text style={styles.section}>{t("LAST 24 HOURS")}</Text>
          <View style={styles.grid}>
            {names.map(name => {
              const value = data.windows["24h"][name];
              if (typeof value !== "number") return null;
              return (
                <View key={`24h-${name}`} style={styles.metric}>
                  <Text style={styles.metricValue} testID={`analytics-count-${name}-24h`}>{formatNumber(value)}</Text>
                  <Text style={styles.metricLabel}>{t(LABELS[name] ?? name)}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.section}>{t("LAST 7 DAYS")}</Text>
          <View style={styles.grid}>
            {names.map(name => {
              const value = data.windows["7d"][name];
              if (typeof value !== "number") return null;
              return (
                <View key={`7d-${name}`} style={styles.metric}>
                  <Text style={styles.metricValue} testID={`analytics-count-${name}-7d`}>{formatNumber(value)}</Text>
                  <Text style={styles.metricLabel}>{t(LABELS[name] ?? name)}</Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { ...type.section, marginTop: spacing.lg },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { minWidth: 104, flexGrow: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] },
  metricLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  action: { minHeight: 40, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, marginTop: spacing.sm },
  actionText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  error: { color: colors.error, marginTop: spacing.sm },
});
