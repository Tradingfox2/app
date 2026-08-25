import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/api";
import {
  FOCUS_LABELS,
  PHASE_LABELS,
  Program,
  ProgramDay,
  ProgramSchema,
} from "@/src/program-schema";
import { colors, radius, spacing } from "@/src/theme";

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
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

function ExerciseRow({ ex }: { ex: any }) {
  return (
    <View style={styles.exRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.exName}>{ex.name}</Text>
        <Text style={styles.exMeta}>
          {ex.sets} × {ex.reps_min === ex.reps_max ? ex.reps_min : `${ex.reps_min}-${ex.reps_max}`} · RPE{" "}
          {ex.target_rpe} · {ex.rest_sec}s rest
          {ex.load_pct_1rm ? ` · ${ex.load_pct_1rm}% 1RM` : ""}
        </Text>
      </View>
    </View>
  );
}

function DayCard({ day, badge }: { day: ProgramDay; badge?: string }) {
  return (
    <View style={styles.dayCard}>
      <View style={styles.dayHead}>
        <Text style={styles.dayTitle}>DAY {day.day_index}</Text>
        <View style={styles.focusBadge}>
          <Text style={styles.focusTxt}>{FOCUS_LABELS[day.focus] ?? day.focus}</Text>
        </View>
        {badge ? (
          <View style={[styles.focusBadge, { backgroundColor: colors.warning }]}>
            <Text style={[styles.focusTxt, { color: "#000" }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {day.exercises.map((ex, i) => (
        <ExerciseRow key={`${ex.exercise_slug}-${i}`} ex={ex} />
      ))}
    </View>
  );
}

export default function ProgramScreen() {
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    try {
      const list = await api.programs();
      const active = list.find((p) => p.status === "active") ?? list[0];
      if (active) {
        const parsed = ProgramSchema.safeParse(active.program);
        if (parsed.success) {
          setProgramDoc(active);
          setProgram(parsed.data);
          setWeekIdx(parsed.data.weeks[0]?.week_index ?? 1);
        }
      }
    } catch {
      // no program yet
    } finally {
      setLoading(false);
    }
  }, []);

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
      Alert.alert("Generation failed", e?.message ?? "Try again");
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
      Alert.alert("Adjustment failed", e?.message ?? "Try again");
    } finally {
      setAdjusting(false);
    }
  };

  const week = program?.weeks.find((w) => w.week_index === weekIdx) ?? program?.weeks[0];
  const rec = programDoc?.recovery_snapshot;

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="program-screen">
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>AI COACH</Text>
        {program ? (
          <Pressable
            testID="regenerate-btn"
            onPress={() => {
              setProgram(null);
              setProgramDoc(null);
              setAdjustResult(null);
            }}
            style={styles.backBtn}
          >
            <Ionicons name="refresh" size={18} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xxl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {!program ? (
            <>
              <Text style={styles.sectionTitle}>GOAL</Text>
              <View style={styles.chipRow}>
                {GOALS.map((g) => (
                  <Chip
                    key={g.key}
                    testID={`goal-${g.key}`}
                    label={g.label}
                    active={goal === g.key}
                    onPress={() => setGoal(g.key)}
                  />
                ))}
              </View>
              <Text style={styles.sectionTitle}>LEVEL</Text>
              <View style={styles.chipRow}>
                {LEVELS.map((l) => (
                  <Chip
                    key={l.key}
                    testID={`level-${l.key}`}
                    label={l.label}
                    active={level === l.key}
                    onPress={() => setLevel(l.key)}
                  />
                ))}
              </View>
              <Text style={styles.sectionTitle}>DAYS / WEEK</Text>
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
              <Text style={styles.sectionTitle}>EQUIPMENT</Text>
              <View style={styles.chipRow}>
                {EQUIPMENT.map((eq) => (
                  <Chip
                    key={eq}
                    testID={`equip-${eq}`}
                    label={eq.toUpperCase()}
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
                style={[styles.cta, generating && { opacity: 0.6 }]}
              >
                {generating ? (
                  <>
                    <ActivityIndicator color={colors.brandOn} size="small" />
                    <Text style={styles.ctaTxt}>BUILDING YOUR BLOCK…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="sparkles" size={16} color={colors.brandOn} />
                    <Text style={styles.ctaTxt}>GENERATE 4-WEEK PROGRAM</Text>
                  </>
                )}
              </Pressable>
              {generating && (
                <Text style={styles.genHint}>
                  Periodization, recovery and your last 14 days of training are being analyzed.
                  This can take 1-2 minutes.
                </Text>
              )}
            </>
          ) : (
            <>
              {rec && (
                <View
                  style={[
                    styles.recBanner,
                    { borderLeftColor: rec.fatigue_high ? colors.warning : colors.success },
                  ]}
                >
                  <Text style={styles.recTitle}>
                    {rec.fatigue_high ? "HIGH FATIGUE AT GENERATION" : "RECOVERY OK AT GENERATION"}
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
                  <Text style={styles.phaseTxt}>{PHASE_LABELS[week.phase] ?? week.phase}</Text>
                </View>
              )}

              <Pressable
                testID="adjust-btn"
                onPress={adjustToday}
                disabled={adjusting}
                style={[styles.adjustBtn, adjusting && { opacity: 0.6 }]}
              >
                {adjusting ? (
                  <ActivityIndicator color={colors.brand} size="small" />
                ) : (
                  <Ionicons name="pulse" size={16} color={colors.brand} />
                )}
                <Text style={styles.adjustTxt}>
                  {adjusting ? "CHECKING RECOVERY…" : "ADJUST TODAY'S SESSION"}
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
                    {adjustResult.adjusted ? "RECOVERY-GATED WORKOUT" : "NO CHANGE NEEDED"}
                  </Text>
                  <Text style={styles.recTxt}>{adjustResult.reason}</Text>
                </View>
              )}

              {adjustResult?.adjusted && (
                <DayCard day={adjustResult.day} badge="ADJUSTED" />
              )}

              {week?.days.map((d) => (
                <DayCard key={d.day_index} day={d} />
              ))}
            </>
          )}
        </ScrollView>
      )}
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
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.text, fontWeight: "900", letterSpacing: 3, fontSize: 15 },
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
    minHeight: 40,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { color: colors.textMuted, fontWeight: "800", fontSize: 12, letterSpacing: 1 },
  chipTxtActive: { color: colors.brandOn },
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
  phaseRow: { marginVertical: spacing.md },
  phaseTxt: { color: colors.brand, fontWeight: "900", letterSpacing: 3, fontSize: 12 },
  adjustBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    minHeight: 48,
    marginBottom: spacing.md,
  },
  adjustTxt: { color: colors.brand, fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },
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
    backgroundColor: colors.brandDim,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  focusTxt: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  exRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  exName: { color: colors.text, fontWeight: "700", fontSize: 14 },
  exMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
