import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import Svg, { Polyline, Line, Circle } from "react-native-svg";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function ProgressionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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

  const chart = useMemo(() => {
    const w = 320;
    const h = 160;
    const pad = 24;
    if (series.length === 0) return { w, h, pad, points: [], min: 0, max: 0 };
    const vals = series.map((s: any) => s.best_e1rm);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = Math.max(1, max - min);
    const stepX = series.length === 1 ? 0 : (w - pad * 2) / (series.length - 1);
    const points = series.map((s: any, i: number) => {
      const x = pad + i * stepX;
      const y = h - pad - ((s.best_e1rm - min) / range) * (h - pad * 2);
      return { x, y, ...s };
    });
    return { w, h, pad, points, min, max };
  }, [series]);

  const totalTonnage = series.reduce((acc: number, s: any) => acc + (s.tonnage || 0), 0);
  const totalSets = series.reduce((acc: number, s: any) => acc + (s.sets || 0), 0);

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="progression-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="back-btn">
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
          {chart.points.length === 0 ? (
            <View style={styles.chartEmpty}>
              <Ionicons name="analytics-outline" size={40} color={colors.textDim} />
              <Text style={styles.emptyTxt}>{t("Log some sets to see progression")}</Text>
            </View>
          ) : (
            <Svg width="100%" height={chart.h} viewBox={`0 0 ${chart.w} ${chart.h}`}>
              <Line
                x1={chart.pad}
                y1={chart.h - chart.pad}
                x2={chart.w - chart.pad}
                y2={chart.h - chart.pad}
                stroke={colors.border}
                strokeWidth={1}
              />
              <Polyline
                points={chart.points.map((p: any) => `${p.x},${p.y}`).join(" ")}
                stroke={colors.text}
                strokeWidth={3}
                fill="none"
              />
              {chart.points.map((p: any, i: number) => (
                <Circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={4}
                  fill={colors.text}
                  stroke={colors.bg}
                  strokeWidth={2}
                />
              ))}
            </Svg>
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
  title: { color: colors.text, fontWeight: "900", letterSpacing: 3, fontSize: 14 },
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
