import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { api, type AnalyticsSummary } from "@/src/api";
import { METRIC_GLOSSARY } from "@/src/analytics-locales";
import { MetricGlossary } from "@/src/components/metric-glossary";
import { radius, spacing } from "@/src/theme";
import { staffColors as colors, staffFonts, staffType as type } from "./staff-theme";
import { useI18n } from "@/src/i18n";

const LABELS: Record<string, string> = {
  screen_view: "Screen views",
  ticket_created: "Tickets created",
  ticket_replied: "Ticket replies",
  post_created: "Posts created",
  post_shared: "Posts shared",
  live_session_started: "Live sessions started",
  live_session_joined: "Live sessions joined",
  live_session_ended: "Live sessions ended",
  story_created: "Stories created",
  workout_completed: "Workouts completed",
};

/**
 * Staff rollup. Names and numbers are the `GET /admin/analytics` payload.
 * A name is drawn only when that window returns a number.
 */
export function AnalyticsPanel() {
  const { t, formatNumber, formatDate } = useI18n();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setError("");
    try {
      const next = await api.adminAnalytics();
      if (id !== requestId.current) return;
      setData(next);
    } catch (cause) {
      if (id !== requestId.current) return;
      setData(null);
      setError(cause instanceof Error ? cause.message : t("Could not load analytics"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const names = data ? Object.keys(data.windows["24h"]) : [];
  const chip = (window: "24h" | "7d", name: string) => {
    if (!data) return null;
    const value = data.windows[window][name];
    if (typeof value !== "number") return null;
    const label = t(LABELS[name] ?? name);
    const shown = formatNumber(value);
    const glossaryKey = METRIC_GLOSSARY[name as keyof typeof METRIC_GLOSSARY];
    const body = (
      <>
        <Text style={styles.metricValue} testID={`analytics-count-${name}-${window}`}>{shown}</Text>
        <Text style={styles.metricLabel}>{label}</Text>
      </>
    );
    if (!glossaryKey) return <View key={`${window}-${name}`} style={styles.metric}>{body}</View>;
    return (
      <MetricGlossary
        key={`${window}-${name}`}
        testID={`analytics-metric-${name}-${window}`}
        value={shown}
        label={label}
        glossary={t(glossaryKey)}
        style={styles.metric}
      >
        {body}
      </MetricGlossary>
    );
  };

  return (
    <View testID="analytics-panel">
      <Text style={styles.section}>{t("Product events")}</Text>
      <Text style={styles.hint}>{t("Counts are read from stored events. Nothing on this page is estimated.")}</Text>
      <Affordance accessibilityRole="button" testID="analytics-refresh" onPress={() => { setLoading(true); void load(); }} style={styles.action}>
        <Text style={styles.actionText}>{t("Refresh counts")}</Text>
      </Affordance>
      {loading ? <ActivityIndicator color={colors.text} /> : null}
      {error ? (
        <View accessibilityRole="alert">
          <Text style={styles.error}>{error}</Text>
          <Affordance accessibilityRole="button" testID="analytics-retry" onPress={() => { setLoading(true); void load(); }} style={styles.action}>
            <Text style={styles.actionText}>{t("Retry")}</Text>
          </Affordance>
        </View>
      ) : null}
      {data ? (
        <>
          {data.generated_at ? <Text style={styles.hint}>{t("Updated {time}.", { time: formatDate(data.generated_at, { dateStyle: "short", timeStyle: "short" }) })}</Text> : null}
          <Text style={styles.section}>{t("LAST 24 HOURS")}</Text>
          <View style={styles.grid}>
            {names.map(name => chip("24h", name))}
          </View>
          <Text style={styles.section}>{t("LAST 7 DAYS")}</Text>
          <View style={styles.grid}>
            {names.map(name => chip("7d", name))}
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
  metricValue: { color: colors.text, fontFamily: staffFonts.display, fontSize: 28, lineHeight: 32, fontVariant: ["tabular-nums"] },
  metricLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  action: { minHeight: 40, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, marginTop: spacing.sm },
  actionText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  error: { color: colors.error, marginTop: spacing.sm },
});
