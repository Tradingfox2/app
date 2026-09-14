import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { enqueueSet, flushQueue, onQueueChange } from "@/src/offline-queue";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function WorkoutLogger() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, formatNumber } = useI18n();
  const [sets, setSets] = useState<any[]>([]);
  const [exercises, setExercises] = useState<any[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerMuscle, setPickerMuscle] = useState<string | null>(null);
  const [muscles, setMuscles] = useState<any[]>([]);
  const [selectedEx, setSelectedEx] = useState<any | null>(null);
  const [reps, setReps] = useState("8");
  const [weight, setWeight] = useState("60");
  const [rpe, setRpe] = useState("7");
  const [queued, setQueued] = useState(0);

  // Rest timer
  const [restRemaining, setRestRemaining] = useState<number>(0);
  const restRef = useRef<any>(null);

  useEffect(() => {
    const unsub = onQueueChange(setQueued);
    return unsub;
  }, []);

  // Exercises queued from the Muscle Explorer / circuits (workout.planned_exercises)
  const [planned, setPlanned] = useState<any[]>([]);
  const [workoutTitle, setWorkoutTitle] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    await flushQueue().catch(() => {});
    const [s, ex, ms, w] = await Promise.all([
      api.listSets(id).catch(() => []),
      api.exercises().catch(() => []),
      api.muscles().catch(() => []),
      api.workout(id).catch(() => null),
    ]);
    setSets(s);
    setExercises(ex);
    setMuscles(ms);
    const plan: any[] = w?.planned_exercises ?? [];
    setPlanned(plan);
    setWorkoutTitle(w?.title ?? null);
    // Prefer the first planned exercise that has no sets yet, then any planned, then the catalog.
    if (!selectedEx) {
      const logged = new Set(s.map((x: any) => x.exercise_id));
      const next = plan.find((p) => !logged.has(p.id)) ?? plan[0] ?? ex[0];
      if (next) setSelectedEx(next);
    }
  }, [id, selectedEx]);

  // Reload on mount and whenever the screen regains focus (e.g. back from the
  // Muscle Explorer after queueing more exercises into this session).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Rest timer countdown
  useEffect(() => {
    if (restRemaining <= 0) return;
    restRef.current = setTimeout(() => setRestRemaining((v) => v - 1), 1000);
    return () => clearTimeout(restRef.current);
  }, [restRemaining]);

  const filteredEx = useMemo(() => {
    return exercises.filter((e) => {
      if (pickerMuscle && e.primary_muscle_slug !== pickerMuscle) return false;
      if (!pickerQuery.trim()) return true;
      return e.name.toLowerCase().includes(pickerQuery.toLowerCase());
    });
  }, [exercises, pickerQuery, pickerMuscle]);

  const nextSetIndex = useMemo(() => {
    if (!selectedEx) return 1;
    const same = sets.filter((s) => s.exercise_id === selectedEx.id);
    return same.length + 1;
  }, [sets, selectedEx]);

  const quickAddSet = async () => {
    if (!selectedEx || !id) return;
    const r = parseInt(reps, 10);
    const w = parseFloat(weight);
    const rp = parseFloat(rpe);
    if (!r || Number.isNaN(w)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Optimistic local update — sub-3-second UX guarantee
    const optimistic = {
      id: `local-${Date.now()}`,
      workout_id: id,
      exercise_id: selectedEx.id,
      set_index: nextSetIndex,
      reps: r,
      weight_kg: w,
      rpe: Number.isNaN(rp) ? null : rp,
    };
    setSets((prev) => [...prev, optimistic]);
    await enqueueSet(id, {
      exercise_id: selectedEx.id,
      set_index: nextSetIndex,
      reps: r,
      weight_kg: w,
      rpe: Number.isNaN(rp) ? null : rp,
    });
    setRestRemaining(90); // default 90s rest
  };

  const setsByEx = useMemo(() => {
    const out: Record<string, any[]> = {};
    sets.forEach((s) => {
      (out[s.exercise_id] = out[s.exercise_id] || []).push(s);
    });
    return out;
  }, [sets]);

  const [finished, setFinished] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState("");
  const finish = async () => {
    if (!id) return;
    // Flush first: the share card snapshots the sets the server holds, so an
    // offline-queued set must land before the session is closed.
    await flushQueue().catch(() => {});
    await api.finishWorkout(id).catch(() => {});
    setFinished(true);
  };
  const share = async () => {
    if (!id || sharing) return;
    setSharing(true); setShareError("");
    try { await api.publish({ content: "", workout_id: id }); router.replace("/community"); }
    catch (cause) { setShareError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { setSharing(false); }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="workout-logger">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" color={colors.text} size={26} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={styles.title}>{t("LIVE SESSION")}</Text>
          {workoutTitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {workoutTitle}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={finish} testID="finish-btn" hitSlop={12}>
          <Text style={styles.finishTxt}>{t("FINISH")}</Text>
        </Pressable>
      </View>

      {planned.length > 0 && (
        <View style={styles.planWrap} testID="planned-queue">
          <Text style={styles.planLabel}>{t("PLANNED · {count}", { count: formatNumber(planned.length) })}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.planRow}
          >
            {planned.map((p, i) => {
              const done = (setsByEx[p.id] || []).length;
              const active = selectedEx?.id === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setSelectedEx(p)}
                  style={[styles.planChip, active && styles.planChipActive, done > 0 && styles.planChipDone]}
                  accessibilityRole="button"
                  accessibilityLabel={t("{name}, {count} sets logged", { name: p.name, count: formatNumber(done) })}
                  testID={`planned-${p.slug}`}
                >
                  <Text style={[styles.planIdx, active && styles.planTxtActive]}>{i + 1}</Text>
                  <Text style={[styles.planName, active && styles.planTxtActive]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  {done > 0 ? (
                    <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => router.push("/muscles")}
              style={[styles.planChip, styles.planChipAdd]}
              accessibilityRole="button"
              accessibilityLabel={t("Add exercises from the muscle explorer")}
            >
              <Ionicons name="add" size={16} color={colors.brand} />
              <Text style={[styles.planName, { color: colors.brand }]}>{t("Add")}</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {queued > 0 && (
        <View style={styles.offlineBanner} testID="offline-banner">
          <Ionicons name="cloud-offline" color={colors.warning} size={14} />
          <Text style={styles.offlineTxt}>{t(queued === 1 ? "{count} set pending sync" : "{count} sets pending sync", { count: formatNumber(queued) })}</Text>
        </View>
      )}

      {restRemaining > 0 && (
        <View style={styles.timer} testID="rest-timer">
          <Text style={styles.timerLabel}>{t("REST")}</Text>
          <Text style={styles.timerVal}>{restRemaining}s</Text>
          <Pressable onPress={() => setRestRemaining(0)} testID="skip-timer-btn">
            <Ionicons name="close" color={colors.brandOn} size={18} />
          </Pressable>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }}>
          <Pressable
            testID="pick-exercise-btn"
            style={styles.exSelector}
            onPress={() => setPickerOpen(true)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.exSelectorLabel}>{t("EXERCISE")}</Text>
              <Text style={styles.exSelectorName}>
                {selectedEx?.name ?? t("Pick an exercise")}
              </Text>
            </View>
            <Ionicons name="chevron-down" color={colors.brand} size={22} />
          </Pressable>

          {selectedEx && (
            <View style={styles.setsCard}>
              <Text style={styles.setsHeader}>{t("SETS · {count}", { count: formatNumber(setsByEx[selectedEx.id]?.length || 0) })}</Text>
              {(setsByEx[selectedEx.id] || []).map((s) => (
                <View key={s.id} style={styles.setRow}>
                  <Text style={styles.setIdx}>#{s.set_index}</Text>
                  <Text style={styles.setVal}>{t("{count} reps", { count: formatNumber(s.reps) })}</Text>
                  <Text style={styles.setVal}>{formatNumber(s.weight_kg)} kg</Text>
                  <Text style={styles.setValDim}>
                    {s.rpe ? `RPE ${s.rpe}` : "—"}
                  </Text>
                </View>
              ))}
              {(setsByEx[selectedEx.id] || []).length === 0 && (
                <Text style={styles.setEmpty}>{t("No sets logged yet.")}</Text>
              )}
            </View>
          )}

          {selectedEx && (
            <Pressable
              testID="see-progression-btn"
              style={styles.progLink}
              onPress={() => router.push(`/progression/${selectedEx.id}`)}
            >
              <Ionicons name="trending-up" color={colors.brand} size={16} />
              <Text style={styles.progLinkTxt}>{t("See progression & PR")}</Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Fast-entry bar */}
        <View style={styles.entryBar}>
          <FieldCol label="REPS" value={reps} onChange={setReps} testID="input-reps" />
          <FieldCol label="KG" value={weight} onChange={setWeight} testID="input-weight" />
          <FieldCol label="RPE" value={rpe} onChange={setRpe} testID="input-rpe" />
          <Pressable
            style={styles.addBtn}
            onPress={quickAddSet}
            testID="add-set-btn"
          >
            <Ionicons name="add" color={colors.brandOn} size={26} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>{t("PICK EXERCISE")}</Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={12}>
                <Ionicons name="close" color={colors.text} size={22} />
              </Pressable>
            </View>
            <TextInput
              placeholder={t("Search…")}
              placeholderTextColor={colors.textDim}
              style={styles.pickerSearch}
              value={pickerQuery}
              onChangeText={setPickerQuery}
              testID="picker-search"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pickerChips}
            >
              <PickerChip
                label={t("ALL")}
                active={!pickerMuscle}
                onPress={() => setPickerMuscle(null)}
              />
              {muscles.map((m) => (
                <PickerChip
                  key={m.slug}
                  label={m.name}
                  active={pickerMuscle === m.slug}
                  onPress={() => setPickerMuscle(m.slug)}
                />
              ))}
            </ScrollView>
            <FlatList
              data={filteredEx}
              keyExtractor={(e) => e.id}
              contentContainerStyle={{ paddingBottom: spacing.xxl }}
              renderItem={({ item }) => (
                <Pressable
                  testID={`picker-item-${item.slug}`}
                  style={styles.pickerItem}
                  onPress={() => {
                    setSelectedEx(item);
                    setPickerOpen(false);
                    setPickerQuery("");
                  }}
                >
                  <Text style={styles.pickerItemName}>{item.name}</Text>
                  <Text style={styles.pickerItemMeta}>
                    {item.equipment} · {item.difficulty}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
      {finished ? <View style={styles.sharePanel} testID="share-panel">
        <Text style={styles.shareTitle}>{t("SESSION COMPLETE")}</Text>
        <Text style={styles.shareCopy}>{t("Share it with the people you train with?")}</Text>
        {shareError ? <Text style={styles.shareError}>{shareError}</Text> : null}
        <View style={styles.shareRow}>
          <Pressable accessibilityRole="button" testID="share-done" onPress={() => router.back()} style={styles.shareSecondary}><Text style={styles.shareSecondaryText}>{t("DONE")}</Text></Pressable>
          <Pressable accessibilityRole="button" testID="share-workout" disabled={sharing} onPress={() => void share()} style={[styles.sharePrimary, sharing && { opacity: 0.5 }]}><Text style={styles.sharePrimaryText}>{t("SHARE TO FEED")}</Text></Pressable>
        </View>
      </View> : null}
    </SafeAreaView>
  );
}

function FieldCol({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testID: string;
}) {
  return (
    <View style={styles.col}>
      <Text style={styles.colLabel}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        style={styles.colInput}
        selectTextOnFocus
      />
    </View>
  );
}

function PickerChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pchip, active && styles.pchipActive]}
    >
      <Text style={[styles.pchipTxt, active && styles.pchipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sharePanel: { position: "absolute", left: 16, right: 16, bottom: 32, padding: 20, borderRadius: 12, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.brand, gap: 8 },
  shareTitle: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  shareCopy: { color: colors.text, fontSize: 15 },
  shareError: { color: colors.error, fontSize: 12 },
  shareRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  shareSecondary: { flex: 1, minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  shareSecondaryText: { color: colors.text, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  sharePrimary: { flex: 1.4, minHeight: 48, borderRadius: 8, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  sharePrimaryText: { color: colors.brandOn, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontWeight: "900", letterSpacing: 3, fontSize: 14 },
  subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 2, maxWidth: 220 },
  planWrap: { marginBottom: spacing.sm },
  planLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "800",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  planRow: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  planChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    maxWidth: 220,
  },
  planChipActive: { borderColor: colors.brand, backgroundColor: colors.brandDim },
  planChipDone: { borderColor: colors.success },
  planChipAdd: { borderStyle: "dashed", borderColor: colors.brand, backgroundColor: "transparent" },
  planIdx: { color: colors.textDim, fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  planName: { color: colors.text, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  planTxtActive: { color: colors.brand },
  finishTxt: {
    color: colors.brand,
    fontWeight: "800",
    letterSpacing: 1.2,
    minHeight: 44,
    textAlignVertical: "center",
    paddingHorizontal: spacing.sm,
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "#3a2a10",
    marginHorizontal: spacing.lg,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  offlineTxt: { color: colors.warning, fontSize: 12, fontWeight: "700" },
  timer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brand,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  timerLabel: { color: colors.brandOn, fontWeight: "800", letterSpacing: 2 },
  timerVal: {
    color: colors.brandOn,
    fontWeight: "800",
    flex: 1,
    fontSize: 20,
    fontVariant: ["tabular-nums"],
  },
  exSelector: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  exSelectorLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: "800" },
  exSelectorName: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 4 },
  setsCard: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  setsHeader: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setIdx: {
    color: colors.success,
    fontWeight: "800",
    width: 34,
    fontVariant: ["tabular-nums"],
  },
  setVal: {
    color: colors.text,
    fontWeight: "700",
    width: 70,
    fontVariant: ["tabular-nums"],
  },
  setValDim: { color: colors.textMuted, fontSize: 12 },
  setEmpty: { color: colors.textDim, fontStyle: "italic", padding: spacing.sm },
  progLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.md,
  },
  progLinkTxt: { color: colors.brand, fontWeight: "700" },
  entryBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  col: { flex: 1 },
  colLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "800",
    marginBottom: 4,
  },
  colInput: {
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    borderRadius: radius.md,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    fontVariant: ["tabular-nums"],
  },
  addBtn: {
    backgroundColor: colors.brand,
    width: 60,
    height: 56,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: "85%",
  },
  pickerHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  pickerTitle: { color: colors.text, fontWeight: "900", letterSpacing: 2 },
  pickerSearch: {
    backgroundColor: colors.surface2,
    color: colors.text,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  pickerChips: { gap: spacing.sm, paddingBottom: spacing.md },
  pchip: {
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    justifyContent: "center",
    flexShrink: 0,
  },
  pchipActive: { borderColor: colors.brand, backgroundColor: colors.brandDim },
  pchipTxt: { color: colors.textMuted, fontWeight: "700", fontSize: 11 },
  pchipTxtActive: { color: colors.brand },
  pickerItem: {
    padding: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerItemName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  pickerItemMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
