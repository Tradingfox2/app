import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { leaveOrHome } from "@/src/leave-home";
import { api } from "@/src/api";
import { LineChart, chartGeometry } from "@/src/components/line-chart";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function ProgressionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, formatNumber } = useI18n();
  const [data, setData] = useState<{ series: any[]; pr: any } | null>(null);
  const [exName, setExName] = useState<string>("Exercise");

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [d, exs] = await Promise.all([
        api.progression(id).catch(() => ({ series: [], pr: null })),
        api.exercises().catch(() => []),
      ]);
      setData(d as any);
      const found = exs.find((e: any) => e.id === id);
      if (found) setExName(found.name);
    })();
  }, [id]);

  const series = useMemo(() => data?.series ?? [], [data?.series]);
  const pr = data?.pr;

  const values = useMemo(
    () => series.map((item: { best_e1rm: number }) => item.best_e1rm),
    [series],
  );
  const chart = useMemo(() => chartGeometry(values), [values]);

  const totalTonnage = series.reduce((acc: number, s: any) => acc + (s.tonnage || 0), 0);
  const totalSets = series.reduce((acc: number, s: any) => acc + (s.sets || 0), 0);

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="progression-screen">
      <View style={styles.header}>
        <Pressable onPress={leaveOrHome} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel={t("Back")}>
          <Ionicons name="chevron-back" color={colors.text} size={26} />
        </Pressable>
        <Text style={styles.title}>{t("PROGRESSION")}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
        <Text style={styles.exName}>{exName}</Text>

        {pr && (
          <View style={styles.prCard} testID="pr-card">
            <Text style={styles.prMark}>{t("PR")}</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: spacing.sm }}>
              <Text style={styles.prVal}>{pr.e1rm}</Text>
              <Text style={styles.prUnit}>kg e1RM</Text>
            </View>
            <Text style={styles.prMeta}>
              {pr.weight_kg} kg × {pr.reps} reps · {pr.date}
            </Text>
          </View>
        )}

        <View style={styles.chartCard}>
          <Text style={styles.cardTitle}>{t("ESTIMATED 1RM")}</Text>
          {values.length === 0 ? (
            <View style={styles.chartEmpty}>
              <Ionicons name="analytics-outline" size={40} color={colors.textDim} />
              <Text style={styles.emptyTxt}>{t("Log some sets to see progression")}</Text>
            </View>
          ) : (
            <LineChart values={values} />
          )}
          <View style={styles.chartFoot}>
            <Text style={styles.footLbl}>{t("MIN")} {formatNumber(Math.round(chart.min))}kg</Text>
            <Text style={styles.footLbl}>{t("MAX")} {formatNumber(Math.round(chart.max))}kg</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatBox label={t("TOTAL TONNAGE")} value={formatNumber(Math.round(totalTonnage))} unit="kg" />
          <StatBox label={t("TOTAL SETS")} value={formatNumber(totalSets)} unit={t("sets")} />
          <StatBox label={t("SESSIONS")} value={formatNumber(series.length)} unit={t("days")} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLbl}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text style={styles.statVal}>{value}</Text>
        <Text style={styles.statUnit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontWeight: "600", letterSpacing: 0.2, fontSize: 22 },
  exName: { color: colors.text, fontSize: 22, fontWeight: "900", marginBottom: spacing.lg },
  prCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  prMark: { color: colors.pr, fontWeight: "700", fontSize: 13, letterSpacing: 0.4 },
  prVal: {
    color: colors.hero,
    fontSize: 36,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  prUnit: { color: colors.textMuted, fontSize: 14 },
  prMeta: { color: colors.textMuted, marginTop: 4 },
  chartCard: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: spacing.md,
  },
  chartEmpty: { alignItems: "center", padding: spacing.xl, gap: spacing.md },
  emptyTxt: { color: colors.textMuted },
  chartFoot: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  footLbl: { color: colors.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: spacing.sm },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statLbl: { color: colors.textMuted, fontSize: 9, letterSpacing: 1.2, fontWeight: "800" },
  statVal: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  statUnit: { color: colors.textMuted, fontSize: 11 },
});
