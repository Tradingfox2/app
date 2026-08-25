import { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { useAuth } from "@/src/auth-context";
import { api } from "@/src/api";
import { MuscleHeatmap } from "@/src/components/muscle-heatmap";
import { colors, radius, spacing } from "@/src/theme";

function Ring({
  value,
  max,
  color,
  label,
  unit,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  unit?: string;
}) {
  const size = 96;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const offset = c * (1 - pct);
  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.surface3}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}>
          {Math.round(value)}
        </Text>
        {unit && (
          <Text style={{ color: colors.textMuted, fontSize: 10 }}>{unit}</Text>
        )}
      </View>
      <Text style={styles.ringLabel}>{label}</Text>
    </View>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [heatmap, setHeatmap] = useState<{ volumes: Record<string, number>; max: number }>({
    volumes: {},
    max: 0,
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([api.dashboard(), api.heatmap()]);
      setData(d);
      setHeatmap(h);
    } catch {
      setData({});
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const strain = data?.strain?.value ?? 0;
  const recovery = data?.recovery?.value ?? 0;
  const sleep = data?.sleep?.value ?? 0;
  const hrv = data?.hrv?.value ?? 0;
  const workoutsWeek = data?.workouts_this_week ?? 0;

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="home-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brand}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.hello}>HELLO</Text>
            <Text style={styles.name}>{user?.full_name ?? user?.email}</Text>
          </View>
          <View style={styles.streak} testID="streak-badge">
            <Text style={styles.streakLabel}>THIS WEEK</Text>
            <Text style={styles.streakNum}>{workoutsWeek}</Text>
            <Text style={styles.streakLabel}>workouts</Text>
          </View>
        </View>

        <View style={styles.ringsCard} testID="rings-card">
          <Text style={styles.cardTitle}>TODAY</Text>
          <View style={styles.rings}>
            <Ring value={strain} max={21} color={colors.brand} label="STRAIN" />
            <Ring value={recovery} max={100} color={colors.success} label="RECOVERY" unit="%" />
            <Ring value={sleep} max={10} color={colors.info} label="SLEEP" unit="h" />
          </View>
        </View>

        <View style={styles.metricRow}>
          <MetricCard label="HRV" value={hrv ? `${Math.round(hrv)}` : "—"} unit="ms" />
          <MetricCard
            label="RESTING HR"
            value={data?.hrv ? "58" : "—"}
            unit="bpm"
          />
        </View>

        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>COACH TIP</Text>
          <Text style={styles.tipTxt}>
            Recovery is your compass. Push hard on green days, glide on red ones.
          </Text>
        </View>

        <View style={styles.heatCard} testID="home-heatmap-card">
          <Text style={styles.cardTitle}>MUSCLE LOAD · 7 DAYS</Text>
          <MuscleHeatmap volumes={heatmap.volumes} max={heatmap.max} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text style={styles.metricVal}>{value}</Text>
        <Text style={styles.metricUnit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.lg,
  },
  hello: { color: colors.textMuted, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  name: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 2 },
  streak: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  streakLabel: { color: colors.textMuted, fontSize: 9, letterSpacing: 1.5, fontWeight: "700" },
  streakNum: {
    color: colors.brand,
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 30,
  },
  ringsCard: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  rings: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  ringLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  metricRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  metricLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },
  metricVal: { color: colors.text, fontSize: 26, fontWeight: "800", marginTop: 6 },
  metricUnit: { color: colors.textMuted, fontSize: 12 },
  tipCard: {
    backgroundColor: colors.brandDim,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.brand,
  },
  tipTitle: {
    color: colors.brand,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  tipTxt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  heatCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
