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
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { enqueueSet, flushQueue, onQueueChange } from "@/src/offline-queue";
import { colors, radius, spacing } from "@/src/theme";

export default function WorkoutLogger() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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

  const load = useCallback(async () => {
    if (!id) return;
    await flushQueue().catch(() => {});
    const [s, ex, ms] = await Promise.all([
      api.listSets(id).catch(() => []),
      api.exercises().catch(() => []),
      api.muscles().catch(() => []),
    ]);
    setSets(s);
    setExercises(ex);
    setMuscles(ms);
    if (!selectedEx && ex.length) setSelectedEx(ex[0]);
  }, [id, selectedEx]);

  useEffect(() => {
    load();
  }, [load]);

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

  const finish = async () => {
    if (!id) return;
    await api.finishWorkout(id).catch(() => {});
    router.back();
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="workout-logger">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" color={colors.text} size={26} />
        </Pressable>
        <Text style={styles.title}>LIVE SESSION</Text>
        <Pressable onPress={finish} testID="finish-btn" hitSlop={12}>
          <Text style={styles.finishTxt}>FINISH</Text>
        </Pressable>
      </View>

      {queued > 0 && (
        <View style={styles.offlineBanner} testID="offline-banner">
          <Ionicons name="cloud-offline" color={colors.warning} size={14} />
          <Text style={styles.offlineTxt}>{queued} set{queued > 1 ? "s" : ""} pending sync</Text>
        </View>
      )}

      {restRemaining > 0 && (
        <View style={styles.timer} testID="rest-timer">
          <Text style={styles.timerLabel}>REST</Text>
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
              <Text style={styles.exSelectorLabel}>EXERCISE</Text>
              <Text style={styles.exSelectorName}>
                {selectedEx?.name ?? "Pick an exercise"}
              </Text>
            </View>
            <Ionicons name="chevron-down" color={colors.brand} size={22} />
          </Pressable>

          {selectedEx && (
            <View style={styles.setsCard}>
              <Text style={styles.setsHeader}>SETS · {setsByEx[selectedEx.id]?.length || 0}</Text>
              {(setsByEx[selectedEx.id] || []).map((s) => (
                <View key={s.id} style={styles.setRow}>
                  <Text style={styles.setIdx}>#{s.set_index}</Text>
                  <Text style={styles.setVal}>{s.reps} reps</Text>
                  <Text style={styles.setVal}>{s.weight_kg} kg</Text>
                  <Text style={styles.setValDim}>
                    {s.rpe ? `RPE ${s.rpe}` : "—"}
                  </Text>
                </View>
              ))}
              {(setsByEx[selectedEx.id] || []).length === 0 && (
                <Text style={styles.setEmpty}>No sets logged yet.</Text>
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
              <Text style={styles.progLinkTxt}>See progression & PR</Text>
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
              <Text style={styles.pickerTitle}>PICK EXERCISE</Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={12}>
                <Ionicons name="close" color={colors.text} size={22} />
              </Pressable>
            </View>
            <TextInput
              placeholder="Search…"
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
                label="ALL"
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
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontWeight: "900", letterSpacing: 3, fontSize: 14 },
  finishTxt: { color: colors.brand, fontWeight: "900", letterSpacing: 2 },
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
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  timerLabel: { color: colors.brandOn, fontWeight: "900", letterSpacing: 2 },
  timerVal: { color: colors.brandOn, fontWeight: "900", flex: 1, fontSize: 20 },
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
  setIdx: { color: colors.brand, fontWeight: "900", width: 34 },
  setVal: { color: colors.text, fontWeight: "700", width: 70 },
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
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
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
