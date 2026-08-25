import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

type Tab = "sessions" | "library";

export default function Workouts() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("sessions");
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [exercises, setExercises] = useState<any[]>([]);
  const [muscles, setMuscles] = useState<any[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [muscle, setMuscle] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    const [w, e, m] = await Promise.all([
      api.workouts().catch(() => []),
      api.exercises().catch(() => []),
      api.muscles().catch(() => []),
    ]);
    setWorkouts(w);
    setExercises(e);
    setMuscles(m);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return exercises.filter((ex) => {
      if (category && ex.category !== category) return false;
      if (muscle && ex.primary_muscle_slug !== muscle) return false;
      return true;
    });
  }, [exercises, category, muscle]);

  const startWorkout = async () => {
    if (!newTitle.trim()) return;
    const w = await api.createWorkout(newTitle.trim());
    setNewTitle("");
    setModal(false);
    await load();
    if (w?.id) router.push(`/workout/${w.id}`);
  };

  const categories = ["strength", "cardio", "plyo"];

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="workouts-screen">
      <View style={styles.header}>
        <Text style={styles.title}>WORKOUTS</Text>
      </View>

      <View style={styles.segment}>
        {(["sessions", "library"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            testID={`tab-${t}-btn`}
            onPress={() => setTab(t)}
            style={[styles.segBtn, tab === t && styles.segBtnActive]}
          >
            <Text style={[styles.segTxt, tab === t && styles.segTxtActive]}>
              {t.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "sessions" ? (
        <FlatList
          data={workouts}
          keyExtractor={(w) => w.id}
          contentContainerStyle={styles.listPad}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="barbell-outline" size={48} color={colors.textDim} />
              <Text style={styles.emptyTxt}>No sessions yet. Start your first!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`workout-${item.id}`}
              style={styles.sessionCard}
              onPress={() => router.push(`/workout/${item.id}`)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.sessionTitle}>{item.title}</Text>
                <Text style={styles.sessionMeta}>
                  {new Date(item.started_at).toLocaleDateString()}{" "}
                  {item.duration_sec
                    ? `· ${Math.round(item.duration_sec / 60)} min`
                    : "· in progress"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" color={colors.textMuted} size={20} />
            </Pressable>
          )}
        />
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsRow}
            contentContainerStyle={styles.chipsContent}
          >
            <Chip label="ALL" active={!category} onPress={() => setCategory(null)} testID="chip-all" />
            {categories.map((c) => (
              <Chip
                key={c}
                testID={`chip-${c}`}
                label={c.toUpperCase()}
                active={category === c}
                onPress={() => setCategory(category === c ? null : c)}
              />
            ))}
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsRow}
            contentContainerStyle={styles.chipsContent}
          >
            {muscles.slice(0, 10).map((m) => (
              <Chip
                key={m.slug}
                testID={`muscle-${m.slug}`}
                label={m.name}
                active={muscle === m.slug}
                onPress={() => setMuscle(muscle === m.slug ? null : m.slug)}
              />
            ))}
          </ScrollView>
          <FlatList
            data={filtered}
            keyExtractor={(e) => e.id}
            contentContainerStyle={styles.listPad}
            renderItem={({ item }) => (
              <View style={styles.exCard} testID={`exercise-${item.slug}`}>
                <View style={styles.exIcon}>
                  <Ionicons name="fitness" color={colors.brand} size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exName}>{item.name}</Text>
                  <Text style={styles.exMeta}>
                    {item.equipment ?? "—"} · {item.difficulty}
                  </Text>
                </View>
                <Text style={styles.exBadge}>{item.category}</Text>
              </View>
            )}
          />
        </>
      )}

      <Pressable
        testID="fab-new-workout"
        style={styles.fab}
        onPress={() => setModal(true)}
      >
        <Ionicons name="add" color={colors.brandOn} size={28} />
        <Text style={styles.fabTxt}>NEW SESSION</Text>
      </Pressable>

      <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModal(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>NEW SESSION</Text>
            <TextInput
              testID="input-workout-title"
              placeholder="Session name"
              placeholderTextColor={colors.textDim}
              style={styles.sheetInput}
              value={newTitle}
              onChangeText={setNewTitle}
            />
            <Pressable style={styles.sheetCta} onPress={startWorkout} testID="submit-workout-btn">
              <Text style={styles.sheetCtaTxt}>START</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: "900", letterSpacing: 2 },
  segment: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.md,
  },
  segBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: "center", borderRadius: radius.pill },
  segBtnActive: { backgroundColor: colors.brand },
  segTxt: { color: colors.textMuted, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  segTxtActive: { color: colors.brandOn },
  chipsRow: { maxHeight: 56 },
  chipsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    alignItems: "center",
    height: 56,
  },
  chip: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.brandDim },
  chipTxt: { color: colors.textMuted, fontWeight: "700", fontSize: 11, letterSpacing: 1 },
  chipTxtActive: { color: colors.brand },
  listPad: { padding: spacing.lg, paddingBottom: 140 },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  sessionTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sessionMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  exCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  exIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
  },
  exName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  exMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2, textTransform: "capitalize" },
  exBadge: {
    color: colors.brand,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  empty: { alignItems: "center", padding: spacing.xxxl, gap: spacing.md },
  emptyTxt: { color: colors.textMuted },
  fab: {
    position: "absolute",
    bottom: 82,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  fabTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 2 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: spacing.md,
  },
  sheetInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetCta: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  sheetCtaTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 2 },
});
