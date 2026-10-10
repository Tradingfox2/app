import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { leaveOrHome } from "@/src/leave-home";
import { api } from "@/src/api";
import {
  FOCUS_LABELS,
  PHASE_LABELS,
  Program,
  ProgramDay,
  ProgramSchema,
} from "@/src/program-schema";
import { usePressFeedback } from "@/src/press-feedback";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { isActivitySession, listOpenSessions, openSessionHref, type OpenSession } from "@/src/open-session";

const GOALS = [
  { key: "strength", label: "STRENGTH" },
  { key: "hypertrophy", label: "HYPERTROPHY" },
  { key: "endurance", label: "ENDURANCE" },
  { key: "fat_loss", label: "FAT LOSS" },
  { key: "general", label: "GENERAL" },
];
const LEVELS = [
  { key: "beginner", label: "BEGINNER" },
  { key: "intermediate", label: "INTERMEDIATE" },
  { key: "advanced", label: "ADVANCED" },
];
const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "kettlebell", "bodyweight"];

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const press = usePressFeedback();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={press("chip", [styles.chip, active && styles.chipActive])}
    >
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

function ExerciseRow({ ex }: { ex: any }) {
  const { t } = useI18n();
  return (
    <View style={styles.exRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.exName}>{ex.name}</Text>
        <Text style={styles.exMeta}>
          {ex.sets} × {ex.reps_min === ex.reps_max ? ex.reps_min : `${ex.reps_min}-${ex.reps_max}`} · RPE{" "}
          {ex.target_rpe} · {t("{seconds}s rest", { seconds: ex.rest_sec })}
          {ex.load_pct_1rm ? ` · ${ex.load_pct_1rm}% 1RM` : ""}
        </Text>
      </View>
    </View>
  );
}

function DayCard({
  day,
  badge,
  onStart,
  starting,
}: {
  day: ProgramDay;
  badge?: string;
  onStart?: () => void;
  starting?: boolean;
}) {
  const { t } = useI18n();
  const press = usePressFeedback();
  return (
    <View style={styles.dayCard} testID={`day-card-${day.day_index}`}>
      <View style={styles.dayHead}>
        <Text style={styles.dayTitle}>{t("DAY {day}", { day: day.day_index })}</Text>
        <View style={styles.focusBadge}>
          <Text style={styles.focusTxt}>{t(FOCUS_LABELS[day.focus] ?? day.focus)}</Text>
        </View>
        {badge ? (
          <View style={styles.focusBadge}>
            <Text style={styles.focusTxt}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {day.exercises.map((ex, i) => (
        <ExerciseRow key={`${ex.exercise_slug}-${i}`} ex={ex} />
      ))}
      {onStart ? (
        <Pressable
          onPress={onStart}
          disabled={starting}
          accessibilityRole="button"
          accessibilityLabel={t("Start day {day} session", { day: day.day_index })}
          testID={`start-day-${day.day_index}`}
          style={press("primary", [styles.startDayBtn, starting && { opacity: 0.6 }], { disabled: !!starting })}
        >
          {starting ? (
            <ActivityIndicator color={colors.brandOn} size="small" />
          ) : (
            <Ionicons name="play" size={14} color={colors.brandOn} />
          )}
          <Text style={styles.startDayTxt}>
            {starting ? t("OPENING…") : t("START DAY {day}", { day: day.day_index })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function goBack() {
  leaveOrHome();
}

export default function ProgramScreen() {
  const { t } = useI18n();
  const press = usePressFeedback();
  const params = useLocalSearchParams<{ workoutId?: string | string[] }>();
  const targetWorkoutId = Array.isArray(params.workoutId) ? params.workoutId[0] : params.workoutId;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openedWeek, setOpenedWeek] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [programDoc, setProgramDoc] = useState<any>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [weekIdx, setWeekIdx] = useState(1);
  const [adjustResult, setAdjustResult] = useState<any>(null);

  const [goal, setGoal] = useState("hypertrophy");
  const [level, setLevel] = useState("intermediate");
  const [days, setDays] = useState(4);
  const [equipment, setEquipment] = useState<string[]>(["barbell", "dumbbell", "bodyweight"]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const list = await api.programs();
      setLoadError(null);
      const active = Array.isArray(list) ? (list.find((p) => p.status === "active") ?? list[0]) : undefined;
      if (active) {
        const parsed = ProgramSchema.safeParse(active.program);
        if (parsed.success) {
          setProgramDoc(active);
          setProgram(parsed.data);
          const first = parsed.data.weeks[0]?.week_index ?? 1;
          setOpenedWeek((current) => current ?? first);
          setWeekIdx((current) => (parsed.data.weeks.some((week) => week.week_index === current) ? current : first));
        } else {
          setProgramDoc(null);
          setProgram(null);
          setLoadError(t("Could not load your plan."));
        }
      } else {
        setProgramDoc(null);
        setProgram(null);
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t("Could not load your plan."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    setAdjustResult(null);
    try {
      const doc = await api.generateProgram({
        goal,
        level,
        days_per_week: days,
        equipment,
        weeks_count: 4,
      });
      const parsed = ProgramSchema.parse(doc.program);
      setProgramDoc(doc);
      setProgram(parsed);
      setWeekIdx(parsed.weeks[0]?.week_index ?? 1);
    } catch (e: any) {
      Alert.alert(t("Generation failed"), e?.message ?? t("Try again"));
    } finally {
      setGenerating(false);
    }
  };

  const adjustToday = async () => {
    if (!programDoc) return;
    setAdjusting(true);
    try {
      const res = await api.adjustProgram(programDoc.id, weekIdx);
      setAdjustResult(res);
    } catch (e: any) {
      Alert.alert(t("Adjustment failed"), e?.message ?? t("Try again"));
    } finally {
      setAdjusting(false);
    }
  };

  // Turn a program day into a live session via POST /programs/{id}/start-day.
  // An explicit workout id receives the plan. Another open session is a choice,
  // never a silent merge.
  const [startingDay, setStartingDay] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [mergePrompt, setMergePrompt] = useState<
    | { kind: "lift"; day: ProgramDay; slugs: string[]; openId: string; openTitle: string }
    | { kind: "choose"; day: ProgramDay; slugs: string[]; rows: OpenSession[] }
    | null
  >(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const openLogger = (workoutId: string) => router.push(`/workout/${workoutId}` as Href);
  const reportStartError = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : t("Could not start session");
    setStartError(message);
    Alert.alert(t("Could not start session"), message);
  };
  const startDay = async (day: ProgramDay, _adjusted = false) => {
    if (startingDay !== null || !programDoc?.id) return;
    setStartingDay(day.day_index);
    setStartError(null);
    try {
      const slugs = day.exercises.map((ex) => ex.exercise_slug).filter(Boolean);
      if (targetWorkoutId) {
        if (slugs.length) await api.planExercises(targetWorkoutId, slugs);
        openLogger(targetWorkoutId);
        return;
      }
      const openRows = await listOpenSessions();
      const lifts = openRows.filter((row) => !isActivitySession(row));
      if (openRows.length === 1 && lifts.length === 1) {
        const open = lifts[0];
        setMergePrompt({ kind: "lift", day, slugs, openId: open.id, openTitle: open.title || t("Session") });
        return;
      }
      if (openRows.length > 0) {
        setMergePrompt({ kind: "choose", day, slugs, rows: openRows });
        return;
      }
      const created = await api.startProgramDay(programDoc.id, { week_index: weekIdx, day_index: day.day_index });
      if (!created?.id) throw new Error(t("Could not start session"));
      openLogger(created.id);
    } catch (e: unknown) {
      reportStartError(e);
    } finally {
      setStartingDay(null);
    }
  };
  const confirmMerge = async () => {
    if (!mergePrompt || mergePrompt.kind !== "lift" || mergeBusy) return;
    setMergeBusy(true);
    setStartError(null);
    try {
      if (mergePrompt.slugs.length) await api.planExercises(mergePrompt.openId, mergePrompt.slugs);
      const openId = mergePrompt.openId;
      setMergePrompt(null);
      openLogger(openId);
    } catch (e: unknown) {
      reportStartError(e);
    } finally {
      setMergeBusy(false);
    }
  };
  const chooseOpen = async (row: OpenSession) => {
    if (!mergePrompt || mergePrompt.kind !== "choose" || mergeBusy) return;
    if (isActivitySession(row)) {
      setMergePrompt(null);
      router.push(openSessionHref(row) as Href);
      return;
    }
    setMergeBusy(true);
    setStartError(null);
    try {
      if (mergePrompt.slugs.length) await api.planExercises(row.id, mergePrompt.slugs);
      setMergePrompt(null);
      router.push(openSessionHref(row) as Href);
    } catch (e: unknown) {
      reportStartError(e);
    } finally {
      setMergeBusy(false);
    }
  };
  const startFreshDay = async () => {
    if (!mergePrompt || mergeBusy || !programDoc?.id) return;
    setMergeBusy(true);
    setStartError(null);
    try {
      const created = await api.startProgramDay(programDoc.id, {
        week_index: weekIdx,
        day_index: mergePrompt.day.day_index,
      });
      if (!created?.id) throw new Error(t("Could not start session"));
      setMergePrompt(null);
      openLogger(created.id);
    } catch (e: unknown) {
      reportStartError(e);
    } finally {
      setMergeBusy(false);
    }
  };

  const week = program?.weeks.find((w) => w.week_index === weekIdx) ?? program?.weeks[0];
  const rec = programDoc?.recovery_snapshot;

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="program-screen">
      <View style={styles.header}>
        <Pressable
          testID="back-btn"
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t("Back")}
          style={press("ghost", styles.backBtn)}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("Plan")}</Text>
        {program ? (
          <Pressable
            testID="regenerate-btn"
            accessibilityRole="button"
            accessibilityLabel={t("Refresh plan")}
            onPress={() => void load(true)}
            style={press("ghost", styles.backBtn)}
          >
            <Ionicons name="refresh" size={18} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>
      <Pressable
        testID="add-from-muscles"
        accessibilityRole="button"
        accessibilityLabel={t("Add from muscles")}
        onPress={() => router.push((targetWorkoutId ? `/muscles?workoutId=${targetWorkoutId}` : "/muscles") as Href)}
        style={press("ghost", styles.musclesLink)}
      >
        <Ionicons name="body" size={16} color={colors.text} />
        <Text style={styles.musclesLinkTxt}>{t("Add from muscles")}</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xxl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {loadError && !program ? (
            <View accessibilityRole="alert" testID="program-load-error" style={styles.recBanner}>
              <Text style={styles.recTxt}>{loadError}</Text>
              <Pressable accessibilityRole="button" testID="program-load-retry" onPress={() => void load()} style={styles.musclesLink}>
                <Text style={styles.musclesLinkTxt}>{t("Retry")}</Text>
              </Pressable>
            </View>
          ) : !program ? (
            <>
              <Text style={styles.sectionTitle}>{t("GOAL")}</Text>
              <View style={styles.chipRow}>
                {GOALS.map((g) => (
                  <Chip
                    key={g.key}
                    testID={`goal-${g.key}`}
                    label={t(g.label)}
                    active={goal === g.key}
                    onPress={() => setGoal(g.key)}
                  />
                ))}
              </View>
              <Text style={styles.sectionTitle}>{t("LEVEL")}</Text>
              <View style={styles.chipRow}>
                {LEVELS.map((l) => (
                  <Chip
                    key={l.key}
                    testID={`level-${l.key}`}
                    label={t(l.label)}
                    active={level === l.key}
                    onPress={() => setLevel(l.key)}
                  />
                ))}
              </View>
              <Text style={styles.sectionTitle}>{t("DAYS / WEEK")}</Text>
              <View style={styles.chipRow}>
                {[2, 3, 4, 5, 6].map((d) => (
                  <Chip
                    key={d}
                    testID={`days-${d}`}
                    label={`${d}`}
                    active={days === d}
                    onPress={() => setDays(d)}
                  />
                ))}
              </View>
              <Text style={styles.sectionTitle}>{t("EQUIPMENT")}</Text>
              <View style={styles.chipRow}>
                {EQUIPMENT.map((eq) => (
                  <Chip
                    key={eq}
                    testID={`equip-${eq}`}
                    label={t(eq.toUpperCase())}
                    active={equipment.includes(eq)}
                    onPress={() =>
                      setEquipment((prev) =>
                        prev.includes(eq) ? prev.filter((x) => x !== eq) : [...prev, eq]
                      )
                    }
                  />
                ))}
              </View>

              <Pressable
                testID="generate-btn"
                onPress={generate}
                disabled={generating}
                style={press("primary", [styles.cta, generating && { opacity: 0.6 }], { disabled: generating })}
              >
                {generating ? (
                  <>
                    <ActivityIndicator color={colors.brandOn} size="small" />
                    <Text style={styles.ctaTxt}>{t("BUILDING YOUR BLOCK…")}</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="sparkles" size={16} color={colors.brandOn} />
                    <Text style={styles.ctaTxt}>{t("GENERATE 4-WEEK PROGRAM")}</Text>
                  </>
                )}
              </Pressable>
              {generating && (
                <Text style={styles.genHint}>
                  {t("Periodization, recovery and your last 14 days of training are being analyzed. This can take 1-2 minutes.")}
                </Text>
              )}
            </>
          ) : (
            <>
              {loadError ? (
                <View accessibilityRole="alert" testID="program-load-error" style={styles.recBanner}>
                  <Text style={styles.recTxt}>{loadError}</Text>
                  <Pressable accessibilityRole="button" testID="program-load-retry" onPress={() => void load(true)} style={styles.musclesLink}>
                    <Text style={styles.musclesLinkTxt}>{t("Retry")}</Text>
                  </Pressable>
                </View>
              ) : null}
              {rec && (
                <View
                  style={[
                    styles.recBanner,
                    { borderLeftColor: rec.fatigue_high ? colors.warning : colors.success },
                  ]}
                >
                  <Text style={styles.recTitle}>
                    {rec.fatigue_high ? t("HIGH FATIGUE AT GENERATION") : t("RECOVERY OK AT GENERATION")}
                  </Text>
                  <Text style={styles.recTxt}>
                    HRV {rec.hrv ?? "—"}ms (7d {rec.hrv_baseline_7d ?? "—"}ms) · Sleep{" "}
                    {rec.sleep_hours ?? "—"}h · Score {rec.recovery_score ?? "—"}%
                  </Text>
                </View>
              )}

              <View style={styles.chipRow}>
                {program.weeks.map((w) => (
                  <Chip
                    key={w.week_index}
                    testID={`week-${w.week_index}`}
                    label={`W${w.week_index}`}
                    active={weekIdx === w.week_index}
                    onPress={() => {
                      setWeekIdx(w.week_index);
                      setAdjustResult(null);
                    }}
                  />
                ))}
              </View>
              {week && (
                <View style={styles.phaseRow}>
                  <Text style={styles.phaseTxt}>{t(PHASE_LABELS[week.phase] ?? week.phase)}</Text>
                </View>
              )}

              <Pressable
                testID="adjust-btn"
                onPress={adjustToday}
                disabled={adjusting}
                style={press("outline", [styles.adjustBtn, adjusting && { opacity: 0.6 }], { disabled: adjusting, preserveBorder: true })}
              >
                {adjusting ? (
                  <ActivityIndicator color={colors.text} size="small" />
                ) : (
                  <Ionicons name="pulse" size={16} color={colors.text} />
                )}
                <Text style={styles.adjustTxt}>
                  {adjusting
                    ? t("CHECKING RECOVERY…")
                    : weekIdx === (openedWeek ?? program.weeks[0]?.week_index)
                      ? t("ADJUST TODAY'S SESSION")
                      : t("ADJUST WEEK {week}", { week: weekIdx })}
                </Text>
              </Pressable>

              {adjustResult && (
                <View
                  style={[
                    styles.recBanner,
                    {
                      borderLeftColor: adjustResult.adjusted ? colors.warning : colors.success,
                    },
                  ]}
                  testID="adjust-result"
                >
                  <Text style={styles.recTitle}>
                    {adjustResult.adjusted ? t("RECOVERY-GATED WORKOUT") : t("NO CHANGE NEEDED")}
                  </Text>
                  <Text style={styles.recTxt}>{adjustResult.reason}</Text>
                </View>
              )}

              {startError ? (
                <View accessibilityRole="alert" testID="program-start-error" style={styles.recBanner}>
                  <Text style={styles.recTxt}>{startError}</Text>
                </View>
              ) : null}
              {(week?.days ?? []).map((d) => {
                const replaced = Boolean(adjustResult?.adjusted && adjustResult.day?.day_index === d.day_index);
                const day = replaced ? adjustResult.day : d;
                return (
                  <DayCard
                    key={day.day_index}
                    day={day}
                    badge={replaced ? t("ADJUSTED") : undefined}
                    onStart={() => startDay(day, replaced)}
                    starting={startingDay === day.day_index}
                  />
                );
              })}
            </>
          )}
        </ScrollView>
      )}
      <Modal visible={!!mergePrompt} transparent animationType="fade" onRequestClose={() => setMergePrompt(null)}>
        <Pressable style={styles.mergeBackdrop} onPress={() => { if (!mergeBusy) setMergePrompt(null); }}>
          <Pressable style={styles.mergeSheet} testID="merge-session-sheet" onPress={(event) => event.stopPropagation()}>
            {mergePrompt?.kind === "choose" ? (
              <>
                <Text style={styles.headerTitle}>{t("Choose an open session")}</Text>
                {mergePrompt.rows.map((row) => (
                  <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={row.title || t("Session")} testID={`merge-open-${row.id}`} disabled={mergeBusy} onPress={() => void chooseOpen(row)} style={press("ghost", [styles.musclesLink, mergeBusy && { opacity: 0.6 }], { disabled: mergeBusy })}>
                    <Text style={styles.musclesLinkTxt}>{row.title || t("Session")}</Text>
                  </Pressable>
                ))}
              </>
            ) : (
              <>
                <Text style={styles.headerTitle}>{t("Add these exercises to {title}?", { title: mergePrompt?.kind === "lift" ? mergePrompt.openTitle : "" })}</Text>
                <Pressable accessibilityRole="button" testID="merge-into-open" disabled={mergeBusy} onPress={() => void confirmMerge()} style={press("primary", [styles.cta, mergeBusy && { opacity: 0.6 }], { disabled: mergeBusy })}>
                  <Text style={styles.ctaTxt}>{t("ADD TO OPEN SESSION")}</Text>
                </Pressable>
              </>
            )}
            <Pressable accessibilityRole="button" testID="merge-new-session" disabled={mergeBusy} onPress={() => void startFreshDay()} style={press("ghost", [styles.musclesLink, mergeBusy && { opacity: 0.6 }], { disabled: mergeBusy })}>
              <Text style={styles.musclesLinkTxt}>{t("NEW SESSION")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  musclesLink: {
    minHeight: 44,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
  },
  musclesLinkTxt: { color: colors.text, fontWeight: "800" },
  mergeBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: spacing.xl },
  mergeSheet: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: "600", letterSpacing: 0.2 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    minHeight: 44,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { color: colors.textMuted, fontWeight: "400", fontSize: 13 },
  chipTxtActive: { color: colors.brandOn, fontWeight: "600" },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  ctaTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 2, fontSize: 13 },
  genHint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.md,
    lineHeight: 18,
  },
  recBanner: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  recTitle: { color: colors.text, fontWeight: "900", fontSize: 11, letterSpacing: 1.5 },
  recTxt: { color: colors.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  phaseRow: {
    marginVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  phaseTxt: { color: colors.text, fontWeight: "700", letterSpacing: 0.6, fontSize: 12 },
  startDayBtn: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  startDayTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },
  adjustBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.text,
    borderRadius: radius.pill,
    minHeight: 48,
    marginBottom: spacing.md,
  },
  adjustTxt: { color: colors.text, fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },
  dayCard: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  dayHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  dayTitle: { color: colors.text, fontWeight: "900", letterSpacing: 2, fontSize: 13 },
  focusBadge: {
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  focusTxt: { color: colors.text, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  exRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  exName: { color: colors.text, fontWeight: "700", fontSize: 14 },
  exMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
