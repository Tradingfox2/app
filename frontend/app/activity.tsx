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
import Svg, { Rect } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import {
  dateFromDayKey,
  dayTraining,
  loggedMinutes,
  parseDayKey,
  readDailyMetric,
  rollupSets,
  weekActivity,
  workoutIdsOnDay,
  type ActivityWorkout,
  type DayTraining,
  type SetRollup,
} from "@/src/activity-day";
import { ActivityRing } from "@/src/components/activity-ring";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing, type } from "@/src/theme";

type FigureState =
  | { kind: "loading" }
  | { kind: "error"; message: string; retryTestID: string; onRetry: () => void }
  | { kind: "unavailable"; text: string }
  | { kind: "value"; primary: string; note: string | null; device: string | null };

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function minuteText(
  seconds: number,
  t: (source: string, values?: Record<string, string | number>) => string,
  formatNumber: (value: number) => string,
): string {
  const minutes = loggedMinutes(seconds);
  if (minutes === null) return t("Less than 1 min");
  return t("{count} min", { count: formatNumber(minutes) });
}

export default function ActivityDayScreen() {
  const params = useLocalSearchParams<{ day?: string | string[] }>();
  const rawDay = Array.isArray(params.day) ? params.day[0] : params.day;
  const dayKey = parseDayKey(rawDay);
  const { t, formatDate, formatNumber } = useI18n();
  const [workouts, setWorkouts] = useState<ActivityWorkout[] | null>(null);
  const [workoutError, setWorkoutError] = useState<string | null>(null);
  const [workoutSettled, setWorkoutSettled] = useState(false);
  const [stepRows, setStepRows] = useState<unknown[] | null>(null);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [stepsSettled, setStepsSettled] = useState(false);
  const [calorieRows, setCalorieRows] = useState<unknown[] | null>(null);
  const [caloriesError, setCaloriesError] = useState<string | null>(null);
  const [caloriesSettled, setCaloriesSettled] = useState(false);
  const [setsState, setSetsState] = useState<
    | { kind: "pending" }
    | { kind: "ready"; day: string; rollup: SetRollup }
    | { kind: "error"; day: string; message: string }
  >({ kind: "pending" });
  const [setsAttempt, setSetsAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [workoutResult, stepsResult, caloriesResult] = await Promise.allSettled([
      api.workouts(),
      api.wearable("steps"),
      api.wearable("calories"),
    ]);
    if (workoutResult.status === "fulfilled" && Array.isArray(workoutResult.value)) {
      setWorkouts(workoutResult.value as ActivityWorkout[]);
      setWorkoutError(null);
    } else if (workoutResult.status === "fulfilled") {
      setWorkouts(null);
      setWorkoutError(t("Could not load this day"));
    } else {
      setWorkouts(null);
      setWorkoutError(messageOf(workoutResult.reason, t("Could not load this day")));
    }
    if (stepsResult.status === "fulfilled" && Array.isArray(stepsResult.value)) {
      setStepRows(stepsResult.value);
      setStepsError(null);
    } else if (stepsResult.status === "fulfilled") {
      setStepRows(null);
      setStepsError(t("Could not load steps"));
    } else {
      setStepRows(null);
      setStepsError(messageOf(stepsResult.reason, t("Could not load steps")));
    }
    if (caloriesResult.status === "fulfilled" && Array.isArray(caloriesResult.value)) {
      setCalorieRows(caloriesResult.value);
      setCaloriesError(null);
    } else if (caloriesResult.status === "fulfilled") {
      setCalorieRows(null);
      setCaloriesError(t("Could not load calories"));
    } else {
      setCalorieRows(null);
      setCaloriesError(messageOf(caloriesResult.reason, t("Could not load calories")));
    }
    setWorkoutSettled(true);
    setStepsSettled(true);
    setCaloriesSettled(true);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!workoutSettled) return undefined;
    if (!workouts) {
      setSetsState({ kind: "pending" });
      return undefined;
    }
    const ids = workoutIdsOnDay(workouts, dayKey);
    if (ids.length === 0) {
      setSetsState({ kind: "ready", day: dayKey, rollup: { tonnageKg: null, distanceM: null } });
      return undefined;
    }
    let cancel = false;
    setSetsState({ kind: "pending" });
    Promise.all(ids.map((id) => api.listSets(id)))
      .then((groups) => {
        if (cancel) return;
        if (groups.some((group) => !Array.isArray(group))) {
          setSetsState({ kind: "error", day: dayKey, message: t("Could not load distance") });
          return;
        }
        setSetsState({ kind: "ready", day: dayKey, rollup: rollupSets(groups.flat()) });
      })
      .catch((cause: unknown) => {
        if (cancel) return;
        setSetsState({ kind: "error", day: dayKey, message: messageOf(cause, t("Could not load distance")) });
      });
    return () => {
      cancel = true;
    };
  }, [workouts, workoutSettled, dayKey, setsAttempt, t]);

  const steps = stepRows ? readDailyMetric(stepRows, dayKey) : null;
  const calories = calorieRows ? readDailyMetric(calorieRows, dayKey) : null;
  const rollup = setsState.kind === "ready" && setsState.day === dayKey ? setsState.rollup : null;
  const setsError = setsState.kind === "error" && setsState.day === dayKey ? setsState.message : null;
  const setsPending = (Boolean(workouts) && setsState.kind === "pending")
    || (setsState.kind !== "pending" && setsState.day !== dayKey);
  const training = workouts ? dayTraining(workouts, dayKey) : null;
  const week = weekActivity(workouts ?? []);
  const selected = week.find((day) => day.key === dayKey) ?? null;
  const ringFill = selected ? selected.fill : training?.seconds ? 1 : 0;
  const date = dateFromDayKey(dayKey);
  const dateLabel = formatDate(date, { day: "numeric", month: "short", year: "numeric" });
  const isToday = dayKey === parseDayKey(undefined);

  const trainingState: FigureState = !workoutSettled
    ? { kind: "loading" }
    : workoutError
      ? { kind: "error", message: workoutError, retryTestID: "activity-day-retry", onRetry: () => void load() }
      : training?.seconds
        ? { kind: "value", primary: minuteText(training.seconds, t, formatNumber), note: null, device: null }
        : {
            kind: "unavailable",
            text: training?.open
              ? t("In progress")
              : training?.durationMissing
                ? t("Duration not logged")
                : t("Not measured"),
          };

  const caloriesState: FigureState = !caloriesSettled
    ? { kind: "loading" }
    : caloriesError
      ? { kind: "error", message: caloriesError, retryTestID: "activity-calories-retry", onRetry: () => void load() }
      : calories
        ? {
            kind: "value",
            primary: t("{count} kcal", { count: formatNumber(Math.round(calories.value)) }),
            note: calories.simulated ? t("Sample data") : null,
            device: calories.device,
          }
        : { kind: "unavailable", text: t("Not measured") };

  const stepsState: FigureState = !stepsSettled
    ? { kind: "loading" }
    : stepsError
      ? { kind: "error", message: stepsError, retryTestID: "activity-steps-retry", onRetry: () => void load() }
      : steps
        ? {
            kind: "value",
            primary: formatNumber(Math.round(steps.value)),
            note: steps.simulated ? t("Sample data") : null,
            device: steps.device,
          }
        : { kind: "unavailable", text: t("Not measured") };

  const distanceState: FigureState = !workoutSettled || setsPending
    ? { kind: "loading" }
    : workoutError
      ? { kind: "error", message: workoutError, retryTestID: "activity-distance-retry", onRetry: () => void load() }
      : setsError
        ? { kind: "error", message: setsError, retryTestID: "activity-sets-retry", onRetry: () => setSetsAttempt((attempt) => attempt + 1) }
        : rollup?.distanceM
          ? { kind: "value", primary: distancePrimary(rollup.distanceM, t, formatNumber), note: null, device: null }
          : { kind: "unavailable", text: t("Not measured") };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="activity-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.textMuted}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Back")}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
            hitSlop={12}
            style={styles.back}
            testID="activity-back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.kicker}>{t("Activity")}</Text>
        </View>

        <Text style={styles.date} testID="activity-date">
          {isToday ? t("Today {date}", { date: dateLabel }) : dateLabel}
        </Text>

        <View style={styles.week} testID="activity-week">
          {week.map((day) => {
            const selectedDay = day.key === dayKey;
            return (
              <Pressable
                key={day.key}
                accessibilityRole="button"
                accessibilityLabel={formatDate(day.date, { weekday: "long" })}
                accessibilityState={{ selected: selectedDay }}
                testID={`activity-day-${day.key}`}
                onPress={() => router.setParams({ day: day.key })}
                style={[styles.weekDay, selectedDay && styles.weekDayOn]}
              >
                <Text style={[styles.weekLetter, selectedDay && styles.weekLetterOn]}>
                  {formatDate(day.date, { weekday: "narrow" })}
                </Text>
                <ActivityRing
                  size={28}
                  stroke={3}
                  progress={day.fill}
                  color={colors.blaze}
                  marker={day.trained && day.fill <= 0}
                />
              </Pressable>
            );
          })}
        </View>

        <View style={styles.plate} testID="activity-ring">
          <ActivityRing size={168} stroke={14} progress={ringFill} color={colors.blaze} />
        </View>

        <View style={styles.stack} testID="activity-training">
          <Text style={styles.word}>{t("Training")}</Text>
          <FigureBody state={trainingState} />
        </View>

        <View style={styles.stack} testID="activity-calories">
          <Text style={styles.word}>{t("Calories")}</Text>
          <FigureBody state={caloriesState} />
        </View>

        <HourChart
          loading={!workoutSettled}
          error={workoutError}
          training={training}
          onRetry={() => void load()}
          t={t}
          formatNumber={formatNumber}
        />

        <View style={styles.pair}>
          <View style={styles.pairCell} testID="activity-steps">
            <Text style={styles.word}>{t("Steps")}</Text>
            <FigureBody state={stepsState} />
          </View>
          <View style={styles.pairCell} testID="activity-distance">
            <Text style={styles.word}>{t("Distance")}</Text>
            <FigureBody state={distanceState} />
          </View>
        </View>

        {rollup?.tonnageKg ? (
          <Text style={styles.volume} testID="activity-volume">
            {t("Volume")} {formatNumber(Math.round(rollup.tonnageKg))} kg
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function distancePrimary(
  meters: number,
  t: (source: string, values?: Record<string, string | number>) => string,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  if (meters >= 1000) {
    return t("{count} km", {
      count: formatNumber(meters / 1000, { maximumFractionDigits: 1 }),
    });
  }
  return t("{count} m", { count: formatNumber(Math.round(meters)) });
}

function FigureBody({ state }: { state: FigureState }) {
  const { t } = useI18n();
  switch (state.kind) {
    case "loading":
      return <View style={styles.skeleton} accessibilityLabel={t("Loading activity")} />;
    case "error":
      return (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorTxt}>{state.message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={state.onRetry}
            testID={state.retryTestID}
            style={styles.retryBtn}
          >
            <Text style={styles.retryTxt}>{t("Retry")}</Text>
          </Pressable>
        </View>
      );
    case "unavailable":
      return <Text style={styles.unavailable}>{state.text}</Text>;
    case "value":
      return (
        <View>
          <Text style={styles.heroValue}>{state.primary}</Text>
          {state.note ? <Text style={styles.note}>{state.note}</Text> : null}
          {state.device ? <Text style={styles.note}>{t("From {device}", { device: state.device })}</Text> : null}
        </View>
      );
    default: {
      const neverState: never = state;
      return neverState;
    }
  }
}

function HourChart({
  loading,
  error,
  training,
  onRetry,
  t,
  formatNumber,
}: {
  loading: boolean;
  error: string | null;
  training: DayTraining | null;
  onRetry: () => void;
  t: (source: string, values?: Record<string, string | number>) => string;
  formatNumber: (value: number) => string;
}) {
  const [width, setWidth] = useState(0);
  if (loading) {
    return <View style={styles.skeleton} accessibilityLabel={t("Loading activity")} testID="activity-hours-loading" />;
  }
  if (error || !training) {
    return (
      <View style={styles.errorBanner} accessibilityRole="alert">
        <Text style={styles.errorTxt} testID="activity-hours-error">{error ?? t("Could not load this day")}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} testID="activity-hours-retry" style={styles.retryBtn}>
          <Text style={styles.retryTxt}>{t("Retry")}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.chart} testID="activity-hours">
      <Text style={styles.chartTitle}>{t("Training minutes by hour")}</Text>
      {training.hours.length === 0 ? (
        <Text style={styles.unavailable} testID="activity-hours-empty">
          {training.durationMissing
            ? t("Duration not logged")
            : training.open
              ? t("In progress")
              : t("No logged duration")}
        </Text>
      ) : (
        <>
          <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            <HourBars hours={training.hours} width={width} t={t} formatNumber={formatNumber} />
          </View>
          <Text style={styles.total} testID="activity-hour-total">
            {minuteText(training.seconds ?? 0, t, formatNumber)}
          </Text>
        </>
      )}
    </View>
  );
}

function HourBars({
  hours,
  width,
  t,
  formatNumber,
}: {
  hours: DayTraining["hours"];
  width: number;
  t: (source: string, values?: Record<string, string | number>) => string;
  formatNumber: (value: number) => string;
}) {
  if (width <= 0) return <View style={{ height: 128 }} />;
  const gap = 10;
  const barWidth = Math.max(12, (width - gap * (hours.length - 1)) / hours.length);
  const chartHeight = 112;
  const max = Math.max(...hours.map((bar) => bar.seconds));
  return (
    <View>
      <Svg width={width} height={chartHeight}>
        {hours.map((bar, index) => {
          const height = Math.max(8, (bar.seconds / max) * chartHeight);
          return (
            <Rect
              key={bar.hour}
              x={index * (barWidth + gap)}
              y={chartHeight - height}
              width={Math.min(barWidth, 36)}
              height={height}
              rx={6}
              fill={colors.blaze}
            />
          );
        })}
      </Svg>
      <View style={styles.hourLabels}>
        {hours.map((bar) => (
          <Text
            key={bar.hour}
            style={[styles.hourLabel, { width: barWidth, marginRight: gap }]}
            testID={`activity-hour-${bar.hour}`}
            accessibilityLabel={`${t("Hour {hour}", { hour: formatNumber(bar.hour) })}. ${minuteText(bar.seconds, t, formatNumber)}`}
          >
            {formatNumber(bar.hour)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  top: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -spacing.sm },
  kicker: { ...type.eyebrow, color: colors.textMuted },
  date: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.4,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  week: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.xl },
  weekDay: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "transparent",
  },
  weekDayOn: { borderColor: colors.text },
  weekLetter: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  weekLetterOn: { color: colors.text },
  plate: {
    alignSelf: "center",
    backgroundColor: colors.ringPlate,
    borderRadius: 120,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  stack: { alignItems: "center", marginBottom: spacing.lg },
  word: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  heroValue: {
    color: colors.hero,
    fontSize: 52,
    lineHeight: 56,
    fontWeight: "800",
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  unavailable: {
    color: colors.textMuted,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    textAlign: "center",
  },
  note: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 2,
  },
  chart: { marginBottom: spacing.xl },
  chartTitle: { ...type.eyebrow, marginBottom: spacing.md },
  total: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginTop: spacing.sm,
    fontVariant: ["tabular-nums"],
  },
  hourLabels: { flexDirection: "row", marginTop: 4 },
  hourLabel: { color: colors.textDim, fontSize: 11, fontWeight: "700", textAlign: "center" },
  pair: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.md },
  pairCell: { flex: 1 },
  volume: { color: colors.textMuted, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  skeleton: { height: 36, borderRadius: radius.sm, backgroundColor: colors.surface3, alignSelf: "stretch" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.errorWash,
  },
  errorTxt: { color: colors.text, fontSize: 13, flex: 1 },
  retryBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  retryTxt: { color: colors.text, fontWeight: "800" },
});
