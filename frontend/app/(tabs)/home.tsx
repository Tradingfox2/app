import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, type Href } from "expo-router";
import { useAuth } from "@/src/auth-context";
import { api } from "@/src/api";
import { MuscleHeatmap } from "@/src/components/muscle-heatmap";
import { DidYouKnow } from "@/src/components/did-you-know";
import { LiveNowStrip } from "@/src/components/live-now-strip";
import { ActivityRing } from "@/src/components/activity-ring";
import { CoachMark } from "@/src/components/night/coach-mark";
import { MeterRow } from "@/src/components/night/meter-row";
import { pressableStyle, useReducedMotion } from "@/src/affordance";
import { colors, radius, spacing, type, card, raised } from "@/src/theme";
import { measuredNumber, metricCaption, readReadiness, readSimulated, type MetricCaption } from "@/src/metric-state";
import type { MuscleSlug } from "@/src/components/anatomy/muscle-types";
import { combinationActivation } from "@/src/components/anatomy/muscle-relations";
import { useI18n } from "@/src/i18n";
import { FOCUS_LABELS } from "@/src/program-schema";
import { datedSessionTitle } from "@/src/session-title";
import {
  weekActivity,
  type ActivityWorkout,
  type WeekDayActivity,
} from "@/src/activity-day";
import {
  readTrainingLoad,
  readTrainingTotals,
  readWorkoutCount,
} from "@/src/training-week";
import { readWeeklyReview, weeklyReviewDue, type WeeklyReview } from "@/src/weekly-review";

function unreadLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

function greetingKey(date: Date): "Good morning" | "Good afternoon" | "Good evening" {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function captionLabel(kind: MetricCaption, t: (source: string) => string): string {
  switch (kind) {
    case "not_connected":
      return t("Not connected");
    case "not_measured":
      return t("Not measured");
    case "recorded_zero":
      return t("Recorded zero");
    case "measured":
      return t("Measured");
    case "sample_data":
      return t("Sample data");
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export default function Home() {
  const { user } = useAuth();
  const { t, formatDate, formatNumber } = useI18n();
  const reduceMotion = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();
  const board = windowWidth >= 1100;
  const [data, setData] = useState<any>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [dashSettled, setDashSettled] = useState(false);
  const [heatmap, setHeatmap] = useState<{ volumes: Record<string, number>; max: number }>({
    volumes: {},
    max: 0,
  });
  const [heatLoaded, setHeatLoaded] = useState(false);
  const [heatError, setHeatError] = useState<string | null>(null);
  const [previewMuscle, setPreviewMuscle] = useState<MuscleSlug | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dmUnread, setDmUnread] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [mergePrompt, setMergePrompt] = useState<{ slugs: string[]; openId: string; openTitle: string } | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  const [coach, setCoach] = useState<{ connected: boolean } | null>(null);
  const [coachTip, setCoachTip] = useState<{ tip: string } | null>(null);
  const [workoutStamps, setWorkoutStamps] = useState<ActivityWorkout[] | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarSettled, setCalendarSettled] = useState(false);
  const [opened, setOpened] = useState(0);
  const [review, setReview] = useState<WeeklyReview | null>(null);

  const load = useCallback(async () => {
    const [todayResult, heatResult, workoutsResult] = await Promise.allSettled([
      api.homeToday(),
      api.heatmap(),
      api.workouts(),
    ]);
    if (todayResult.status === "fulfilled") {
      setData(todayResult.value);
      setDashError(null);
    } else {
      const reason = todayResult.reason;
      setDashError(reason instanceof Error ? reason.message : t("Could not load home"));
    }
    if (workoutsResult.status === "fulfilled" && Array.isArray(workoutsResult.value)) {
      setWorkoutStamps(workoutsResult.value);
      setCalendarError(null);
    } else if (workoutsResult.status === "fulfilled") {
      setCalendarError(t("Could not load training days"));
    } else {
      const reason = workoutsResult.reason;
      setCalendarError(reason instanceof Error ? reason.message : t("Could not load training days"));
    }
    setCalendarSettled(true);
    const heatPayload = heatResult.status === "fulfilled" ? heatResult.value : null;
    const heatVolumes = heatPayload && typeof heatPayload === "object" && !Array.isArray(heatPayload) ? heatPayload.volumes : null;
    const heatMax = heatPayload && typeof heatPayload === "object" && !Array.isArray(heatPayload) ? heatPayload.max : null;
    if (heatVolumes && typeof heatVolumes === "object" && !Array.isArray(heatVolumes) && typeof heatMax === "number") {
      setHeatmap({ volumes: heatVolumes, max: heatMax });
      setHeatLoaded(true);
      setHeatError(null);
    } else if (heatResult.status === "fulfilled") {
      setHeatError(t("Could not load muscle load"));
    } else {
      const reason = heatResult.reason;
      setHeatError(reason instanceof Error ? reason.message : t("Could not load muscle load"));
    }
    setDashSettled(true);
    api
      .coachStatus()
      .then((s) => setCoach({ connected: s.connected }))
      .catch(() => setCoach(null));
    api
      .coachTip()
      .then((tip) => setCoachTip({ tip: tip.tip }))
      .catch(() => setCoachTip(null));
    api.dmUnreadCount().then((row) => setDmUnread(row.count || 0)).catch(() => undefined);
    api.unreadNotificationCount().then((row) => setNotifUnread(row.count || 0)).catch(() => undefined);
  }, [t]);

  useFocusEffect(useCallback(() => {
    void load();
    setOpened((count) => count + 1);
  }, [load]));

  // After Today has painted. Sunday is before Monday, so that open does not call.
  useEffect(() => {
    if (!dashSettled || opened === 0 || !weeklyReviewDue(new Date())) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void api.weeklyReview().then((row) => {
        if (cancelled) return;
        const next = readWeeklyReview(row);
        if (next) setReview(next);
      }).catch(() => undefined);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dashSettled, opened]);

  const strain = measuredNumber(data?.strain);
  const trainingLoad = readTrainingLoad(data);
  const loadWeek = trainingLoad?.week ?? null;
  const recovery = measuredNumber(data?.recovery);
  const sleep = measuredNumber(data?.sleep);
  const hrv = measuredNumber(data?.hrv);
  const restingHr = measuredNumber(data?.resting_hr);
  const readiness = readReadiness(data);
  const workoutCount = readWorkoutCount(data);
  const training = readTrainingTotals(data);
  const calendar = workoutStamps ? weekActivity(workoutStamps) : null;
  const wearableConnected = Boolean(data?.wearable_connected);
  const noteFor = (node: unknown, value: number | null) =>
    captionLabel(metricCaption(value, wearableConnected, readSimulated(node)), t);
  const readinessConfidence = data?.readiness?.confidence;
  const showMorning = typeof readinessConfidence === "number" && readinessConfidence < 0.5;
  const activeWorkout = data?.active_workout ?? null;
  const nextSession = data?.next_session ?? null;
  const showSkeleton = !dashSettled;

  const failStart = (cause: unknown) => {
    setStartError(cause instanceof Error ? cause.message : t("Could not start session"));
  };

  const resume = () => {
    if (activeWorkout?.id) router.push(`/workout/${activeWorkout.id}` as Href);
  };

  const startDay = async () => {
    if (!nextSession?.program_id || starting || mergeBusy) return;
    setStarting(true);
    setStartError(null);
    try {
      const slugs = (Array.isArray(nextSession.exercises) ? nextSession.exercises : [])
        .map((row: { exercise_slug?: string }) => row.exercise_slug)
        .filter((slug: string | undefined): slug is string => Boolean(slug));
      let open: { id: string; title?: string; ended_at?: string | null } | undefined;
      try {
        const existing = await api.workouts();
        if (Array.isArray(existing)) {
          open = existing.find((workout: { ended_at?: string | null; id: string; title?: string }) => workout && !workout.ended_at);
        }
      } catch {
        open = undefined;
      }
      if (open?.id) {
        setMergePrompt({ slugs, openId: open.id, openTitle: open.title || t("Session") });
        return;
      }
      const workout = await api.startProgramDay(nextSession.program_id, {
        week_index: nextSession.week_index,
        day_index: nextSession.day_index,
      });
      if (!workout?.id) throw new Error(t("Could not start session"));
      router.push(`/workout/${workout.id}` as Href);
    } catch (cause) {
      failStart(cause);
    } finally {
      setStarting(false);
    }
  };

  const confirmMerge = async () => {
    if (!mergePrompt || mergeBusy) return;
    setMergeBusy(true);
    setStartError(null);
    try {
      if (mergePrompt.slugs.length) await api.planExercises(mergePrompt.openId, mergePrompt.slugs);
      const openId = mergePrompt.openId;
      setMergePrompt(null);
      router.push(`/workout/${openId}` as Href);
    } catch (cause) {
      failStart(cause);
    } finally {
      setMergeBusy(false);
    }
  };

  const startFreshDay = async () => {
    if (!mergePrompt || mergeBusy || !nextSession?.program_id) return;
    setMergeBusy(true);
    setStartError(null);
    try {
      const workout = await api.startProgramDay(nextSession.program_id, {
        week_index: nextSession.week_index,
        day_index: nextSession.day_index,
      });
      if (!workout?.id) throw new Error(t("Could not start session"));
      setMergePrompt(null);
      router.push(`/workout/${workout.id}` as Href);
    } catch (cause) {
      failStart(cause);
    } finally {
      setMergeBusy(false);
    }
  };

  const startEmpty = async () => {
    if (starting || activeWorkout) return;
    setStarting(true);
    setStartError(null);
    try {
      const workout = await api.createWorkout(datedSessionTitle(t, formatDate));
      if (!workout?.id) throw new Error(t("Could not create session"));
      router.push(`/workout/${workout.id}` as Href);
    } catch (cause) {
      failStart(cause);
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
            tintColor={colors.textMuted}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={type.eyebrow}>{t(greetingKey(new Date()))}</Text>
            <Text style={styles.name} numberOfLines={1}>{user?.full_name ?? user?.email}</Text>
          </View>
          <View style={styles.headerActions}>
            <HeaderButton testID="home-search" label={t("Search")} icon="search" onPress={() => router.push("/search")} />
            <HeaderButton
              testID="home-messages"
              badgeTestID="home-dm-badge"
              label={dmUnread ? t("Messages, {count} unread", { count: unreadLabel(dmUnread) ?? dmUnread }) : t("Messages")}
              icon="chatbubble-ellipses-outline"
              badge={unreadLabel(dmUnread)}
              onPress={() => router.push("/messages")}
            />
            <HeaderButton
              testID="home-notifications"
              badgeTestID="home-notif-badge"
              label={notifUnread ? t("Notifications, {count} unread", { count: unreadLabel(notifUnread) ?? notifUnread }) : t("Notifications")}
              icon="notifications-outline"
              badge={unreadLabel(notifUnread)}
              onPress={() => router.push("/notifications")}
            />
          </View>
        </View>

        {dashError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Ionicons name="alert-circle" color={colors.live} size={16} />
            <Text style={styles.errorTxt} testID="home-error">{dashError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              testID="home-retry"
              style={(state) => [styles.retryBtn, pressableStyle(state, { variant: "hairline", reduceMotion })]}
            >
              <Text style={styles.retryTxt}>{t("Retry")}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={board ? styles.board : undefined}>
        <View style={board ? styles.boardStage : undefined}>
        <View testID="today-card" style={[styles.todayCard, styles.stage, board ? styles.stageBoard : null, raised("card"), { backgroundColor: colors.bg }]}>
          <LinearGradient
            colors={[colors.brandWash, colors.bg]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Text style={styles.cardTitle}>{t("TODAY'S SESSION")}</Text>
          {activeWorkout ? (
            <Text style={[styles.stageTitle]} numberOfLines={2}>{activeWorkout.title}</Text>
          ) : nextSession ? (
            <Text style={styles.stageTitle} numberOfLines={2}>{t(FOCUS_LABELS[nextSession.focus] ?? nextSession.focus)}</Text>
          ) : data ? (
            <Text style={styles.stageTitle}>{t("No training plan yet")}</Text>
          ) : null}
          {activeWorkout ? (
            <Text style={styles.todayMeta}>{t("· in progress")}</Text>
          ) : nextSession ? (
            <Text style={styles.todayMeta} testID="today-plan">
              {t("WEEK {week}", { week: nextSession.week_index })}
              {" · "}
              {t("DAY {day}", { day: nextSession.day_index })}
              {" · "}
              {t(FOCUS_LABELS[nextSession.focus] ?? nextSession.focus)}
              {" · "}
              {t((nextSession.exercises?.length ?? 0) === 1 ? "{count} exercise" : "{count} exercises", { count: formatNumber(nextSession.exercises?.length ?? 0) })}
            </Text>
          ) : null}
          {activeWorkout ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Resume your live session")}
              onPress={resume}
              style={(state) => [styles.startCta, styles.resumeCta, pressableStyle(state, { variant: "primary", reduceMotion })]}
              testID="start-workout-cta"
            >
              <Ionicons name="play-circle" size={22} color={colors.brandOn} />
              <Text style={type.button}>{t("RESUME SESSION")}</Text>
            </Pressable>
          ) : nextSession ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Start day {day} session", { day: nextSession.day_index })}
              onPress={() => void startDay()}
              disabled={starting}
              style={(state) => [styles.startCta, pressableStyle(state, { variant: "primary", reduceMotion, disabled: starting })]}
              testID="today-start-day"
            >
              <Ionicons name="play" size={18} color={colors.brandOn} />
              <Text style={type.button}>{starting ? t("STARTING…") : t("START DAY")}</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Generate plan")}
                onPress={() => router.push("/program")}
                style={(state) => [styles.startCta, pressableStyle(state, { variant: "primary", reduceMotion })]}
                testID="today-generate"
              >
                <Ionicons name="sparkles" size={18} color={colors.brandOn} />
                <Text style={type.button}>{t("GENERATE PLAN")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Start a workout")}
                onPress={() => void startEmpty()}
                disabled={starting}
                style={(state) => [styles.secondaryCta, pressableStyle(state, { variant: "quiet", reduceMotion, disabled: starting })]}
                testID="start-workout-cta"
              >
                <Text style={styles.secondaryCtaTxt}>{starting ? t("STARTING…") : t("START EMPTY")}</Text>
              </Pressable>
            </>
          )}
          {startError ? (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <Ionicons name="alert-circle" color={colors.live} size={16} />
              <Text style={styles.errorTxt} testID="start-error">{startError}</Text>
            </View>
          ) : null}
        </View>
        </View>
        <View style={board ? styles.boardSide : undefined}>

        <View style={styles.tipCard} testID="coach-tip-card">
          <Pressable
            onPress={() => router.push("/coach/chat" as Href)}
            accessibilityRole="button"
            accessibilityLabel={t("Open the AI coach")}
            testID="coach-tip-open"
            style={(state) => [styles.coachLine, pressableStyle(state, { variant: "surface", reduceMotion })]}
          >
            <CoachMark size={48} />
            <View style={{ flex: 1 }}>
              <View style={styles.cardHead}>
                <Text style={styles.tipTitle}>{t("COACH")}</Text>
                {coach && !coach.connected ? (
                  <View style={styles.coachBadge}>
                    <Ionicons name="alert-circle" size={14} color={colors.warning} />
                    <Text style={styles.coachBadgeTxt}>{t("AI OFFLINE")}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.tipTxt} testID="coach-tip-text">
                {coachTip?.tip ?? t("Ask about today's session. Training guidance, not a diagnosis.")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/program")}
            accessibilityRole="button"
            accessibilityLabel={t("Open your training plan")}
            testID="coach-tip-plan"
            style={(state) => [styles.tipPlan, pressableStyle(state, { variant: "surface", reduceMotion })]}
          >
            <Text style={styles.tipPlanTxt}>{t("TRAINING PLAN")}</Text>
          </Pressable>
        </View>

        {data ? (
          <View style={styles.statsCard} testID="readiness-card">
            <Text style={styles.cardTitle}>{t("READINESS")}</Text>
            <Text style={type.hero} testID="readiness-value">
              {readiness.kind === "scored" ? formatNumber(readiness.score) : "—"}
            </Text>
            <Text style={styles.readinessNote} testID="readiness-note">
              {readiness.kind === "unavailable"
                ? t("Today's readiness score was not returned.")
                : readiness.kind === "unknown"
                  ? t("Unknown. Not enough measured inputs to score readiness.")
                  : t("Training guidance from the inputs that were present. Not a medical assessment.")}
            </Text>
            {readiness.kind === "scored" && readiness.verdict === "push" ? <Text style={styles.ringCaption}>{t("Push day")}</Text> : null}
            {readiness.kind === "scored" && readiness.verdict === "steady" ? <Text style={styles.ringCaption}>{t("Steady day")}</Text> : null}
            {readiness.kind === "scored" && readiness.verdict === "rest" ? <Text style={styles.ringCaption}>{t("Rest day")}</Text> : null}
            {readiness.kind !== "unavailable" && readiness.missing.length > 0 ? (
              <Text style={styles.ringCaption} testID="readiness-missing">
                {t("Missing")}: {readiness.missing.join(", ")}
              </Text>
            ) : null}
            {readiness.kind !== "unavailable" && readiness.confidence != null ? (
              <Text style={styles.ringCaption} testID="readiness-confidence">
                {t("Input coverage {pct}%", { pct: formatNumber(Math.round(readiness.confidence * 100)) })}
              </Text>
            ) : null}
          </View>
        ) : null}

        {showMorning ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Tell your coach how you slept.")}
            testID="home-morning"
            onPress={() => router.push("/morning" as Href)}
            style={(state) => [styles.coachRow, pressableStyle(state, { variant: "surface", reduceMotion })]}
          >
            <Ionicons name="moon-outline" size={18} color={colors.text} />
            <Text style={styles.coachRowTxt}>{t("HOW YOU SLEPT")}</Text>
          </Pressable>
        ) : null}

        <LiveNowStrip affordance />

        <View style={styles.ringsCard} testID="rings-card">
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t("TODAY")}</Text>
            {data && !wearableConnected ? (
              <Text style={styles.cardHint}>{t("NO WEARABLE DATA")}</Text>
            ) : null}
          </View>
          {showSkeleton ? (
            <View testID="home-skeleton" accessibilityLabel={t("Loading home")} style={styles.meters}>
              <View style={styles.skeletonBar} />
              <View style={styles.skeletonBar} />
              <View style={styles.skeletonBar} />
            </View>
          ) : data ? (
            <>
              <View style={styles.meters}>
                <MeterRow
                  value={strain}
                  max={21}
                  label={t("STRAIN")}
                  caption={noteFor(data?.strain, strain)}
                  testID="ring-strain"
                />
                <MeterRow
                  value={recovery}
                  figure={recovery == null ? "—" : formatNumber(Math.round(recovery))}
                  max={100}
                  label={t("RECOVERY")}
                  unit="%"
                  caption={noteFor(data?.recovery, recovery)}
                  testID="ring-recovery"
                />
                <MeterRow
                  value={sleep}
                  figure={sleep == null ? "—" : formatNumber(sleep)}
                  max={10}
                  label={t("SLEEP")}
                  unit="h"
                  caption={noteFor(data?.sleep, sleep)}
                  testID="ring-sleep"
                />
              </View>
              <View style={styles.metricRow}>
                <MetricCard
                  testID="metric-hrv"
                  label="HRV"
                  value={hrv == null ? "—" : formatNumber(Math.round(hrv))}
                  unit="ms"
                  note={noteFor(data?.hrv, hrv)}
                />
                <MetricCard
                  testID="metric-rhr"
                  label={t("RESTING HR")}
                  value={restingHr == null ? "—" : formatNumber(Math.round(restingHr))}
                  unit="bpm"
                  note={noteFor(data?.resting_hr, restingHr)}
                />
              </View>
              {!wearableConnected && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Connect a wearable source")}
                  onPress={() => router.push("/sources")}
                  style={(state) => [styles.connectRow, pressableStyle(state, { variant: "hairline", reduceMotion })]}
                  testID="connect-source-cta"
                >
                  <Ionicons name="watch-outline" size={16} color={colors.text} />
                  <Text style={styles.connectTxt}>
                    {t("Connect Garmin, Whoop, Oura, Fitbit or Apple Health to show strain, recovery, and sleep")}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.text} />
                </Pressable>
              )}
            </>
          ) : null}
        </View>
        </View>
        </View>

        {review ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Open this review")}
            testID="weekly-review-card"
            onPress={() => router.push("/analysis" as Href)}
            style={(state) => [styles.statsCard, pressableStyle(state, { variant: "surface", reduceMotion })]}
          >
            <Text style={styles.cardTitle}>{t("WEEKLY REVIEW")}</Text>
            <Text style={styles.todayMeta} testID="weekly-review-headline">{review.headline}</Text>
            <Text style={styles.weekEmpty}>{t("WINS")}</Text>
            <Text style={styles.todayMeta}>{review.wins}</Text>
            <Text style={styles.weekEmpty}>{t("WATCH")}</Text>
            <Text style={styles.todayMeta}>{review.watch}</Text>
            <Text style={styles.weekEmpty}>{t("NEXT WEEK")}</Text>
            <Text style={styles.todayMeta}>{review.next_week_change}</Text>
          </Pressable>
        ) : null}

        <View style={styles.statsCard} testID="training-week-card">
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t("TRAINING · 7 DAYS")}</Text>
            <View style={styles.streak} testID="streak-badge">
              <Text style={styles.streakLabel}>{t("THIS WEEK")}</Text>
              {!dashSettled && workoutCount === null ? (
                <View style={styles.skeletonNum} />
              ) : (
                <Text style={styles.streakNum}>{workoutCount === null ? "—" : formatNumber(workoutCount)}</Text>
              )}
              <Text style={styles.streakLabel}>{t("workouts")}</Text>
            </View>
            <View style={styles.streakPill}>
              <Ionicons name="flame" size={12} color={colors.warning} />
              <Text style={styles.streakPillTxt}>
                {training ? t("{count}d streak", { count: formatNumber(training.streakDays) }) : "—"}
              </Text>
            </View>
          </View>
          {trainingLoad ? (
            <View style={styles.loadLine} testID="week-load">
              <Text style={styles.metricLabel}>{t("LOAD")}</Text>
              <Text style={type.metric}>
                {loadWeek == null ? "—" : formatNumber(Math.round(loadWeek))}
              </Text>
              <Text style={styles.metricNote}>
                {loadWeek == null ? t("Not measured") : loadWeek === 0 ? t("Recorded zero") : t("From finished sessions")}
              </Text>
            </View>
          ) : null}
          <WeekVolume
            loading={!dashSettled && training === null && workoutCount === null}
            error={dashError}
            count={workoutCount}
            training={training}
            calendarTrained={Boolean(calendar?.some((day) => day.trained))}
            onRetry={() => void load()}
          />
          <WeekCalendar
            loading={!calendarSettled && calendar === null}
            error={calendar ? null : calendarError}
            days={calendar}
            onRetry={() => void load()}
          />
        </View>

        <DidYouKnow count={7} />

        <View style={styles.quickRow}>
          <QuickAction icon="calendar" label={t("TRAINING PLAN")} testID="quick-program" onPress={() => router.push("/program")} />
          <QuickAction icon="flask" label={t("LABS")} testID="quick-labs" onPress={() => router.push("/labs")} />
          <QuickAction icon="watch" label={t("SOURCES")} testID="quick-sources" onPress={() => router.push("/sources")} />
          <QuickAction icon="qr-code" label={t("CHECK-IN")} testID="quick-checkin" onPress={() => router.push("/checkin")} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Open trends")}
          testID="quick-analysis"
          style={(state) => [styles.coachRow, pressableStyle(state, { variant: "surface", reduceMotion })]}
          onPress={() => router.push("/analysis" as Href)}
        >
          <Ionicons name="analytics-outline" size={18} color={colors.text} />
          <Text style={styles.coachRowTxt}>{t("TRENDS")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Record a walk, run, or ride")}
          testID="quick-record"
          style={(state) => [styles.coachRow, pressableStyle(state, { variant: "surface", reduceMotion })]}
          onPress={() => router.push("/record" as Href)}
        >
          <Ionicons name="walk-outline" size={18} color={colors.text} />
          <Text style={styles.coachRowTxt}>{t("RECORD OUTSIDE")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("TRAIN WITH A COACH")}
          testID="quick-coach"
          style={(state) => [styles.coachRow, pressableStyle(state, { variant: "surface", reduceMotion })]}
          onPress={() => router.push((user?.role === "coach" ? "/partner" : "/coach/onboarding") as Href)}
        >
          <Ionicons name="ribbon-outline" size={18} color={colors.text} />
          <Text style={styles.coachRowTxt}>{t("TRAIN WITH A COACH")}</Text>
        </Pressable>

        <View style={styles.heatCard} testID="home-heatmap-card">
          <Text style={styles.cardTitle}>{t("MUSCLE LOAD · 7 DAYS")}</Text>
          {heatError ? (
            <View accessibilityRole="alert" style={styles.errorBanner}>
              <Ionicons name="alert-circle" color={colors.live} size={16} />
              <Text style={styles.errorTxt} testID="heatmap-error">{heatError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void load()}
                testID="heatmap-retry"
                style={(state) => pressableStyle(state, { variant: "hairline", reduceMotion })}
              >
                <Text style={styles.retryTxt}>{t("Retry")}</Text>
              </Pressable>
            </View>
          ) : null}
          {heatLoaded ? (
          <MuscleHeatmap
            volumes={heatmap.volumes}
            max={heatmap.max}
            selectedMuscle={previewMuscle}
            activation={
              previewMuscle ? combinationActivation(previewMuscle) : undefined
            }
            spinning={false}
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
            affordance
          />
          ) : null}
        </View>
      </ScrollView>
      <Modal
        visible={mergePrompt !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!mergeBusy) setMergePrompt(null); }}
      >
        <Pressable style={styles.mergeBackdrop} onPress={() => { if (!mergeBusy) setMergePrompt(null); }}>
          <Pressable style={styles.mergeSheet} testID="merge-session-sheet" onPress={(event) => event.stopPropagation()}>
            <Text style={type.section}>{t("Add these exercises to {title}?", { title: mergePrompt?.openTitle ?? "" })}</Text>
            <Pressable
              accessibilityRole="button"
              testID="merge-into-open"
              disabled={mergeBusy}
              onPress={() => void confirmMerge()}
              style={(state) => [styles.startCta, pressableStyle(state, { variant: "primary", reduceMotion, disabled: mergeBusy })]}
            >
              <Text style={type.button}>{t("ADD TO OPEN SESSION")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="merge-new-session"
              disabled={mergeBusy}
              onPress={() => void startFreshDay()}
              style={(state) => [styles.secondaryCta, pressableStyle(state, { variant: "quiet", reduceMotion, disabled: mergeBusy })]}
            >
              <Text style={styles.secondaryCtaTxt}>{t("NEW SESSION")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function WeekVolume({
  loading,
  error,
  count,
  training,
  calendarTrained,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  count: number | null;
  training: ReturnType<typeof readTrainingTotals>;
  calendarTrained: boolean;
  onRetry: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const reduceMotion = useReducedMotion();
  if (loading) {
    return <View style={styles.skeletonBar} testID="home-stats-skeleton" accessibilityLabel={t("Loading home")} />;
  }
  const quiet = training !== null
    && count === 0
    && training.sets === 0
    && training.tonnageKg === 0
    && training.minutes === 0
    && training.muscles === 0
    && !calendarTrained;
  if (training && quiet) {
    return (
      <Text style={styles.weekEmpty} testID="week-empty">
        {t("No workouts in the last 7 days")}
      </Text>
    );
  }
  if (training) {
    const heavy = training.tonnageKg >= 1000;
    return (
      <View style={styles.statsRow} testID="week-stats">
        <Stat label={t("SETS")} value={formatNumber(training.sets)} />
        <Stat
          label={t("TONNAGE")}
          value={
            heavy
              ? formatNumber(training.tonnageKg / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
              : formatNumber(Math.round(training.tonnageKg))
          }
          unit={heavy ? "t" : "kg"}
        />
        <Stat label={t("MINUTES")} value={formatNumber(training.minutes)} />
        <Stat label={t("MUSCLES")} value={formatNumber(training.muscles)} />
      </View>
    );
  }
  return (
    <View style={styles.errorBanner} accessibilityRole="alert">
      <Ionicons name="alert-circle" color={colors.live} size={16} />
      <Text style={styles.errorTxt} testID="week-error">{error ?? t("This week is unavailable")}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        testID="week-retry"
        style={(state) => [styles.retryBtn, pressableStyle(state, { variant: "hairline", reduceMotion })]}
      >
        <Text style={styles.retryTxt}>{t("Retry")}</Text>
      </Pressable>
    </View>
  );
}

function WeekCalendar({
  loading,
  error,
  days,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  days: WeekDayActivity[] | null;
  onRetry: () => void;
}) {
  const { t, formatDate } = useI18n();
  const reduceMotion = useReducedMotion();
  if (loading) {
    return <View style={styles.skeletonBar} testID="week-calendar-skeleton" accessibilityLabel={t("Loading home")} />;
  }
  if (!days) {
    if (!error) return null;
    return (
      <View style={styles.errorBanner} accessibilityRole="alert">
        <Ionicons name="alert-circle" color={colors.live} size={16} />
        <Text style={styles.errorTxt} testID="week-days-error">{error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          testID="week-days-retry"
          style={(state) => [styles.retryBtn, pressableStyle(state, { variant: "hairline", reduceMotion })]}
        >
          <Text style={styles.retryTxt}>{t("Retry")}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.weekRow} testID="week-calendar">
      {days.map((day) => {
        const labelKey = day.isToday
          ? day.trained
            ? "{day}, trained, today"
            : "{day}, rest, today"
          : day.trained
            ? "{day}, trained"
            : "{day}, rest";
        const name = formatDate(day.date, { weekday: "long" });
        return (
          <Pressable
            key={day.key}
            accessibilityRole="button"
            accessibilityLabel={`${t(labelKey, { day: name })}. ${t("Open this day")}`}
            testID={`week-day-${day.key}`}
            onPress={() => router.push(`/activity?day=${day.key}` as Href)}
            style={(state) => [
              styles.weekDay,
              day.isToday && styles.weekDayToday,
              pressableStyle(state, { variant: "quiet", reduceMotion }),
            ]}
          >
            <Text style={[styles.weekDayLabel, day.isToday && styles.weekDayLabelToday]}>
              {formatDate(day.date, { weekday: "narrow" })}
            </Text>
            <ActivityRing
              size={22}
              stroke={2.5}
              progress={day.fill}
              color={colors.text}
              marker={day.trained && day.fill <= 0}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function HeaderButton({
  testID,
  badgeTestID,
  label,
  icon,
  badge,
  onPress,
}: {
  testID: string;
  badgeTestID?: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: string | null;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={(state) => [styles.headerIcon, pressableStyle(state, { variant: "quiet", reduceMotion })]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
      {badge ? (
        <View style={styles.headerBadge} testID={badgeTestID}>
          <Text style={styles.headerBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
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
  const reduceMotion = useReducedMotion();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={(state) => [styles.quickBtn, pressableStyle(state, { variant: "surface", reduceMotion })]}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
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

function MetricCard({ label, value, unit, note, testID }: { label: string; value: string; unit: string; note: string; testID: string }) {
  return (
    <View style={styles.metricCard} testID={testID}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text style={type.metric}>{value}</Text>
        <Text style={styles.metricUnit}>{unit}</Text>
      </View>
      <Text style={styles.metricNote}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  headerCopy: { flexGrow: 1, flexShrink: 1, minWidth: 140 },
  headerActions: { flexDirection: "row", alignItems: "center" },
  headerIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerBadge: {
    position: "absolute",
    top: 2,
    right: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBadgeText: { color: colors.bg, fontSize: 10, fontWeight: "700" },
  name: { ...type.screenTitle, marginTop: 4 },
  skeletonNum: { width: 28, height: 26, borderRadius: 6, backgroundColor: colors.surface3, marginVertical: 2 },
  skeletonBar: { height: 28, borderRadius: radius.sm, backgroundColor: colors.surface3 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
    minHeight: 44,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.errorWash,
  },
  errorTxt: { color: colors.text, fontSize: 13, fontWeight: "400", flex: 1 },
  retryBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  retryTxt: { color: colors.text, fontWeight: "800" },
  todayCard: { ...card, padding: spacing.lg, marginBottom: spacing.md, overflow: "hidden" },
  board: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  boardStage: { flex: 1.35, minWidth: 0 },
  boardSide: { flex: 0.85, minWidth: 0 },
  stage: { minHeight: 280, justifyContent: "flex-end" },
  stageBoard: { flex: 1, minHeight: 420 },
  stageTitle: { ...type.stage, marginBottom: spacing.sm },
  coachLine: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 72 },
  meters: { gap: spacing.md, marginBottom: spacing.md },
  loadLine: { marginBottom: spacing.md },
  mergeBackdrop: { flex: 1, backgroundColor: "rgba(16,20,24,0.72)", justifyContent: "flex-end", padding: spacing.lg },
  mergeSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  todayMeta: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: spacing.md },
  secondaryCta: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  secondaryCtaTxt: { color: colors.text, fontWeight: "800", letterSpacing: 1 },
  coachRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  coachRowTxt: { color: colors.text, fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
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
  streakLabel: { ...type.eyebrow, fontSize: 12 },
  streakNum: { ...type.metric, fontSize: 22 },
  ringsCard: {
    ...card,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  ringPlate: {
    backgroundColor: colors.ringPlate,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  cardTitle: {
    ...type.section,
    marginBottom: spacing.md,
  },
  cardHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardHint: { ...type.eyebrow, color: colors.textDim },
  connectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  connectTxt: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "600" },
  resumeCta: { backgroundColor: colors.brand },
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
  weekEmpty: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  weekRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  weekDay: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "transparent",
  },
  weekDayToday: { borderColor: colors.brand },
  weekDayLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  weekDayLabelToday: { color: colors.text },
  rings: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  ringLabel: {
    color: colors.textMuted,
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  ringCaption: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    textAlign: "center",
    maxWidth: 96,
  },
  readinessNote: { color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  metricNote: { color: colors.textDim, fontSize: 12, marginTop: 4 },
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
  quickLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  metricCard: {
    flex: 1,
    ...card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  metricLabel: { ...type.eyebrow },
  metricUnit: { color: colors.textMuted, fontSize: 12 },
  tipCard: {
    ...card,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  tipTitle: {
    ...type.section,
    marginBottom: spacing.xs,
  },
  tipTxt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  tipMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tipPlan: {
    alignSelf: "flex-end",
    marginTop: spacing.md,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tipPlanTxt: { color: colors.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  coachBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.warningWash,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  coachBadgeTxt: { color: colors.warningText, fontSize: 12, fontWeight: "400" },
  heatCard: {
    marginTop: spacing.md,
    ...card,
    padding: spacing.lg,
  },
});
