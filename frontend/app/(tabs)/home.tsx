import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@/src/auth-context";
import { api } from "@/src/api";
import { MuscleHeatmap } from "@/src/components/muscle-heatmap";
import { DidYouKnow } from "@/src/components/did-you-know";
import { LiveNowStrip } from "@/src/components/live-now-strip";
import { colors, radius, spacing, type, card } from "@/src/theme";
import type { MuscleSlug } from "@/src/components/anatomy/muscle-types";
import { combinationActivation } from "@/src/components/anatomy/muscle-relations";
import { useI18n } from "@/src/i18n";

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
        <Text style={type.metric}>{Math.round(value)}</Text>
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
  const { t, formatDate, formatNumber } = useI18n();
  const [data, setData] = useState<any>(null);
  const [heatmap, setHeatmap] = useState<{ volumes: Record<string, number>; max: number }>({
    volumes: {},
    max: 0,
  });
  const [previewMuscle, setPreviewMuscle] = useState<MuscleSlug | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [coach, setCoach] = useState<{ connected: boolean } | null>(null);
  const [coachTip, setCoachTip] = useState<{ tip: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([api.dashboard(), api.heatmap()]);
      setData(d);
      setHeatmap(h);
    } catch {
      setData({});
    }
    api
      .coachStatus()
      .then((s) => setCoach({ connected: s.connected }))
      .catch(() => setCoach(null));
    api
      .coachTip()
      .then((tip) => setCoachTip({ tip: tip.tip }))
      .catch(() => setCoachTip(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const strain = data?.strain?.value ?? 0;
  const recovery = data?.recovery?.value ?? 0;
  const sleep = data?.sleep?.value ?? 0;
  const hrv = data?.hrv?.value ?? 0;
  const restingHr = data?.resting_hr?.value ?? 0;
  const workoutsWeek = data?.workouts_this_week ?? 0;
  const training = data?.training ?? {};
  const wearableConnected = Boolean(data?.wearable_connected);
  const activeWorkout = data?.active_workout ?? null;
  const [starting, setStarting] = useState(false);

  const startOrResume = async () => {
    if (activeWorkout?.id) {
      router.push(`/workout/${activeWorkout.id}`);
      return;
    }
    if (starting) return;
    setStarting(true);
    try {
      const w = await api.createWorkout(
        `${t("Session")} · ${formatDate(new Date(), { weekday: "short", day: "numeric", month: "short" })}`,
      );
      router.push(`/workout/${w.id}`);
    } catch {
      router.push("/(tabs)/workouts");
    } finally {
      setStarting(false);
    }
  };

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
            <Text style={type.eyebrow}>{t("READY TO TRAIN")}</Text>
            <Text style={styles.name}>{user?.full_name ?? user?.email}</Text>
          </View>
          <View style={styles.streak} testID="streak-badge">
            <Text style={styles.streakLabel}>{t("THIS WEEK")}</Text>
            <Text style={styles.streakNum}>{workoutsWeek}</Text>
            <Text style={styles.streakLabel}>{t("workouts")}</Text>
          </View>
        </View>

        <LiveNowStrip />

        <View style={styles.ringsCard} testID="rings-card">
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t("TODAY")}</Text>
            {!wearableConnected && (
              <Text style={styles.cardHint}>{t("NO WEARABLE DATA")}</Text>
            )}
          </View>
          <View style={styles.rings}>
            <Ring value={strain} max={21} color={colors.brand} label={t("STRAIN")} />
            <Ring value={recovery} max={100} color={colors.success} label={t("RECOVERY")} unit="%" />
            <Ring value={sleep} max={10} color={colors.info} label={t("SLEEP")} unit="h" />
          </View>
          {!wearableConnected && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Connect a wearable source")}
              onPress={() => router.push("/sources")}
              style={styles.connectRow}
              testID="connect-source-cta"
            >
              <Ionicons name="watch-outline" size={16} color={colors.brand} />
              <Text style={styles.connectTxt}>
                {t("Connect Garmin, Whoop, Oura, Fitbit or Apple Health to fill these rings")}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.brand} />
            </Pressable>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={activeWorkout ? t("Resume your live session") : t("Start a workout")}
          onPress={startOrResume}
          disabled={starting}
          style={[styles.startCta, activeWorkout && styles.resumeCta]}
          testID="start-workout-cta"
        >
          <Ionicons
            name={activeWorkout ? "play-circle" : "add-circle"}
            size={22}
            color={colors.brandOn}
          />
          <Text style={type.button}>
            {activeWorkout ? t("RESUME SESSION") : starting ? t("STARTING…") : t("START WORKOUT")}
          </Text>
        </Pressable>

        <View style={styles.statsCard} testID="training-week-card">
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t("TRAINING · 7 DAYS")}</Text>
            <View style={styles.streakPill}>
              <Ionicons name="flame" size={12} color={colors.blaze} />
              <Text style={styles.streakPillTxt}>{t("{count}d streak", { count: training.streak_days ?? 0 })}</Text>
            </View>
          </View>
          <View style={styles.statsRow}>
            <Stat label={t("SETS")} value={formatNumber(training.sets_week ?? 0)} />
            <Stat
              label="TONNAGE"
              value={
                (training.tonnage_week_kg ?? 0) >= 1000
                  ? `${((training.tonnage_week_kg ?? 0) / 1000).toFixed(1)}t`
                  : `${Math.round(training.tonnage_week_kg ?? 0)}`
              }
              unit={(training.tonnage_week_kg ?? 0) >= 1000 ? "" : "kg"}
            />
            <Stat label={t("MINUTES")} value={formatNumber(training.minutes_week ?? 0)} />
            <Stat label={t("MUSCLES")} value={formatNumber(training.muscles_week?.length ?? 0)} />
          </View>
        </View>

        <DidYouKnow count={7} />

        <View style={styles.quickRow}>
          <QuickAction icon="sparkles" label={t("AI COACH")} testID="quick-program" onPress={() => router.push("/program")} />
          <QuickAction icon="flask" label={t("LABS")} testID="quick-labs" onPress={() => router.push("/labs")} />
          <QuickAction icon="watch" label={t("SOURCES")} testID="quick-sources" onPress={() => router.push("/sources")} />
          <QuickAction icon="qr-code" label={t("CHECK-IN")} testID="quick-checkin" onPress={() => router.push("/checkin")} />
        </View>

        <View style={styles.metricRow}>
          <MetricCard label="HRV" value={hrv ? `${Math.round(hrv)}` : "—"} unit="ms" />
          <MetricCard
            label={t("RESTING HR")}
            value={restingHr ? `${Math.round(restingHr)}` : "—"}
            unit="bpm"
          />
        </View>

        <Pressable
          style={styles.tipCard}
          onPress={() => router.push("/program")}
          accessibilityRole="button"
          accessibilityLabel={t("Open the AI coach")}
          testID="coach-tip-card"
        >
          <View style={styles.cardHead}>
            <Text style={styles.tipTitle}>{t("COACH TIP")}</Text>
            {coach && !coach.connected ? (
              <View style={styles.coachBadge}>
                <View style={[styles.coachDot, { backgroundColor: colors.warning }]} />
                <Text style={styles.coachBadgeTxt}>{t("AI OFFLINE")}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.tipTxt} testID="coach-tip-text">
            {coachTip?.tip ??
              t("Recovery is your compass. Push hard on green days, glide on red ones.")}
          </Text>
        </Pressable>

        <View style={styles.heatCard} testID="home-heatmap-card">
          <Text style={styles.cardTitle}>{t("MUSCLE LOAD · 7 DAYS")}</Text>
          <MuscleHeatmap
            volumes={heatmap.volumes}
            max={heatmap.max}
            selectedMuscle={previewMuscle}
            activation={
              previewMuscle ? combinationActivation(previewMuscle) : undefined
            }
            spinning
            bodyWidth={previewMuscle ? 158 : 150}
            bodyHeight={previewMuscle ? 316 : 300}
            onPress={() =>
              router.push(
                previewMuscle ? `/muscles?muscle=${previewMuscle}` : "/muscles",
              )
            }
            onMusclePress={(muscle) => {
              setPreviewMuscle((current) =>
                current === muscle ? null : muscle,
              );
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.quickBtn}>
      <Ionicons name={icon} size={20} color={colors.brand} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statVal}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MetricCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text style={type.metric}>{value}</Text>
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
  name: { ...type.screenTitle, marginTop: 4 },
  startCta: {
    minHeight: 52,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
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
    fontWeight: "800",
    lineHeight: 30,
    fontVariant: ["tabular-nums"],
  },
  ringsCard: {
    ...card,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: {
    ...type.section,
    marginBottom: spacing.md,
  },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardHint: { ...type.eyebrow, color: colors.textDim, fontSize: 10 },
  connectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandDim,
  },
  connectTxt: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "600" },
  resumeCta: { backgroundColor: colors.accent },
  statsCard: {
    ...card,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  statsRow: { flexDirection: "row", justifyContent: "space-between" },
  stat: { flex: 1, alignItems: "flex-start" },
  statVal: { ...type.metric, fontSize: 22 },
  statUnit: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  statLabel: { ...type.eyebrow, fontSize: 10, marginTop: 2 },
  streakPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  streakPillTxt: { color: colors.text, fontSize: 11, fontWeight: "700" },
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
  quickRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  quickBtn: {
    flex: 1,
    minHeight: 64,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  quickLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  metricCard: {
    flex: 1,
    ...card,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  metricLabel: { ...type.eyebrow },
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
  coachBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  coachDot: { width: 8, height: 8, borderRadius: 4 },
  coachBadgeTxt: { color: colors.textMuted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  heatCard: {
    marginTop: spacing.md,
    ...card,
    padding: spacing.lg,
  },
});
