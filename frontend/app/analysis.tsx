import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, type TrendSeriesName, type Trends } from "@/src/api";
import { MUSCLE_NAMES } from "@/src/components/anatomy/anatomy-artwork";
import type { MuscleSlug } from "@/src/components/anatomy/muscle-types";
import { LineChart, type LineValue } from "@/src/components/line-chart";
import { dateFromDayKey } from "@/src/activity-day";
import { pressableStyle, useReducedMotion } from "@/src/affordance";
import { useI18n } from "@/src/i18n";
import { card, colors, radius, spacing } from "@/src/theme";

const SERIES: { key: TrendSeriesName; title: string }[] = [
  { key: "readiness", title: "Readiness" },
  { key: "hrv", title: "HRV" },
  { key: "resting_hr", title: "Resting HR" },
  { key: "sleep_hours", title: "Sleep" },
  { key: "load_au", title: "Load" },
  { key: "tonnage", title: "Tonnage" },
];

const MUSCLE_SLUGS = new Set<string>(Object.keys(MUSCLE_NAMES));

function valuesOf(points: { value: number | null }[]): LineValue[] {
  return points.map((point) => (typeof point.value === "number" ? point.value : null));
}

function muscleTitle(slug: string, t: (source: string) => string): string {
  return MUSCLE_SLUGS.has(slug) ? t(MUSCLE_NAMES[slug as MuscleSlug]) : slug;
}

export default function AnalysisScreen() {
  const router = useRouter();
  const { t, formatDate } = useI18n();
  const reduceMotion = useReducedMotion();
  const [days, setDays] = useState<30 | 90>(30);
  const [data, setData] = useState<Trends | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    api.trends(days).then(
      (body) => {
        if (!cancelled) {
          setData(body);
          setLoading(false);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error && cause.message ? cause.message : t("Could not load trends"));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [days, attempt, t]);

  const dayLabel = (key: string) => formatDate(dateFromDayKey(key), { month: "short", day: "numeric" });

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="analysis-screen">
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          testID="back-btn"
          accessibilityRole="button"
          accessibilityLabel={t("Back")}
          style={(state) => pressableStyle(state, { variant: "quiet", reduceMotion })}
        >
          <Ionicons name="chevron-back" color={colors.text} size={26} />
        </Pressable>
        <Text style={styles.title}>{t("TRENDS")}</Text>
        <View style={styles.spacer} />
      </View>
      <View style={styles.tabs}>
        {([30, 90] as const).map((option) => {
          const selected = days === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              testID={`analysis-tab-${option}`}
              onPress={() => setDays(option)}
              style={(state) => [
                styles.tab,
                selected ? styles.tabOn : null,
                pressableStyle(state, { variant: "surface", reduceMotion }),
              ]}
            >
              <Text style={[styles.tabTxt, selected ? styles.tabTxtOn : null]}>{t(option === 30 ? "30 DAYS" : "90 DAYS")}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {loading ? <Text style={styles.muted} testID="analysis-loading">{t("Loading trends")}</Text> : null}
        {error ? (
          <View accessibilityRole="alert" style={styles.errorRow}>
            <Text style={styles.errorTxt} testID="analysis-error">{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAttempt((value) => value + 1)}
              testID="analysis-retry"
              style={(state) => pressableStyle(state, { variant: "quiet", reduceMotion })}
            >
              <Text style={styles.retry}>{t("Retry")}</Text>
            </Pressable>
          </View>
        ) : null}
        {data && !error ? <Text style={styles.range}>{dayLabel(data.start)} – {dayLabel(data.end)}</Text> : null}
        {data && !error ? SERIES.map((series) => {
          const values = valuesOf(data.series[series.key] ?? []);
          const measured = values.some((value) => value !== null);
          return (
            <View key={series.key} style={styles.card} testID={`trend-${series.key}`}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{t(series.title)}</Text>
                <Text style={styles.unit}>{data.units[series.key]}</Text>
              </View>
              {measured ? <LineChart values={values} color={colors.text} testID={`trend-${series.key}-chart`} /> : <Text style={styles.muted} testID={`trend-${series.key}-not-measured`}>{t("Not measured")}</Text>}
            </View>
          );
        }) : null}
        {data && !error ? Object.entries(data.muscles).map(([slug, points]) => {
          const values = valuesOf(points);
          if (!values.some((value) => value !== null)) return null;
          return (
            <View key={slug} style={styles.card} testID={`trend-muscle-${slug}`}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{muscleTitle(slug, t)}</Text>
                <Text style={styles.unit}>{data.units.tonnage}</Text>
              </View>
              <LineChart values={values} color={colors.text} testID={`trend-muscle-${slug}-chart`} />
            </View>
          );
        }) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  spacer: { width: 26 },
  title: { color: colors.text, fontWeight: "900", letterSpacing: 3, fontSize: 14 },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  tab: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabOn: { borderBottomColor: colors.brand },
  tabTxt: { color: colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  tabTxtOn: { color: colors.brand },
  body: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: { ...card, padding: spacing.lg },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: spacing.sm },
  cardTitle: { color: colors.textMuted, fontSize: 11, letterSpacing: 2, fontWeight: "800" },
  unit: { color: colors.textDim, fontSize: 11, fontWeight: "700" },
  muted: { color: colors.textMuted, paddingVertical: spacing.md },
  range: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  errorTxt: { color: colors.live, flex: 1 },
  retry: { color: colors.text, fontWeight: "800" },
});
