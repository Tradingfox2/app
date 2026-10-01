import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { api } from "@/src/api";
import { useFieldAffordance, usePressFeedback } from "@/src/press-feedback";
import { card, colors, radius, spacing } from "@/src/theme";
import { ExerciseDemoModal } from "@/src/components/exercises/exercise-demo-modal";
import { MUSCLE_NAMES } from "@/src/components/anatomy/anatomy-artwork";
import type { MuscleSlug, RecommendationExercise } from "@/src/components/anatomy/muscle-types";
import { useI18n } from "@/src/i18n";
import { datedSessionTitle } from "@/src/session-title";

type Tab = "sessions" | "library";
type LibraryExercise = RecommendationExercise & { id: string };

export default function Workouts() {
  const router = useRouter();
  const { t, formatDate } = useI18n();
  const press = usePressFeedback();
  const searchField = useFieldAffordance();
  const titleField = useFieldAffordance();
  const [tab, setTab] = useState<Tab>("sessions");
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [exercises, setExercises] = useState<LibraryExercise[]>([]);
  const [muscles, setMuscles] = useState<any[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [muscle, setMuscle] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [demoExercise, setDemoExercise] = useState<LibraryExercise | null>(null);
  const [modal, setModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, e, m] = await Promise.all([api.workouts(), api.exercises(), api.muscles()]);
      setWorkouts(w);
      setExercises(e);
      setMuscles(m);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("Could not load sessions"));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return exercises.filter((ex) => {
      if (category && ex.category !== category) return false;
      if (
        muscle &&
        ex.primary_muscle_slug !== muscle &&
        !ex.secondary_muscle_slugs?.includes(muscle as any)
      ) return false;
      if (
        normalizedQuery &&
        !`${ex.name} ${ex.equipment ?? ""} ${ex.instructions ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) return false;
      return true;
    });
  }, [exercises, category, muscle, query]);

  const selectedExercises = useMemo(
    () => selectedSlugs
      .map((slug) => exercises.find((exercise) => exercise.slug === slug))
      .filter((exercise): exercise is LibraryExercise => !!exercise),
    [exercises, selectedSlugs],
  );

  const categories = useMemo(
    () => [
      ...new Set(
        exercises
          .map((exercise) => exercise.category)
          .filter((value): value is string => !!value),
      ),
    ].sort(),
    [exercises],
  );

  const toggleExercise = (slug: string) => {
    setSelectedSlugs((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    );
  };

  const startWorkout = async () => {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const w = await api.createWorkout(
        newTitle.trim(),
        undefined,
        selectedSlugs,
      );
      setNewTitle("");
      setSelectedSlugs([]);
      setModal(false);
      await load();
      if (w?.id) router.push(`/workout/${w.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t("Could not create session"));
    } finally {
      setCreating(false);
    }
  };

  const createDated = async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const w = await api.createWorkout(datedSessionTitle(t, formatDate));
      if (!w?.id) throw new Error(t("Could not create session"));
      await load();
      router.push(`/workout/${w.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t("Could not create session"));
    } finally {
      setCreating(false);
    }
  };

  const openNewSession = () => {
    if (tab === "library" && selectedSlugs.length > 0) {
      setCreateError(null);
      if (!newTitle.trim()) setNewTitle(t("Library Session"));
      setModal(true);
      return;
    }
    void createDated();
  };

  const sessionMeta = (item: { started_at: string; ended_at?: string | null; duration_sec?: number | null }) => {
    const when = formatDate(item.started_at);
    if (!item.ended_at) return `${when} ${t("· in progress")}`;
    return `${when} · ${Math.round((item.duration_sec ?? 0) / 60)} min`;
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="workouts-screen">
      <View style={styles.header}>
        <Text style={styles.title}>{t("WORKOUTS")}</Text>
      </View>

      <View style={styles.segment}>
        {(["sessions", "library"] as Tab[]).map((tabKey) => (
          <Pressable
            key={tabKey}
            testID={`tab-${tabKey}-btn`}
            onPress={() => setTab(tabKey)}
            style={press("chip", [styles.segBtn, tab === tabKey && styles.segBtnActive])}
          >
            <Text style={[styles.segTxt, tab === tabKey && styles.segTxtActive]}>
              {t(tabKey === "sessions" ? "SESSIONS" : "LIBRARY")}
            </Text>
          </Pressable>
        ))}
      </View>

      {loadError ? (
        <View accessibilityRole="alert" style={styles.errorBanner} testID="workouts-error">
          <Text style={styles.createError}>{loadError}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} testID="workouts-retry" style={press("ghost", styles.retryBtn)}>
            <Text style={styles.retryTxt}>{t("Retry")}</Text>
          </Pressable>
        </View>
      ) : null}
      {createError && !modal ? (
        <Text accessibilityRole="alert" style={[styles.createError, styles.errorPad]} testID="create-error">{createError}</Text>
      ) : null}
      {!loaded && !loadError ? <ActivityIndicator color={colors.text} style={{ marginTop: spacing.lg }} testID="workouts-loading" /> : null}

      {tab === "sessions" ? (
        <FlatList
          data={workouts}
          keyExtractor={(w) => w.id}
          contentContainerStyle={styles.listPad}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.text}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            loaded && !loadError ? (
              <View style={styles.empty} testID="sessions-empty">
                <Ionicons name="barbell-outline" size={48} color={colors.textDim} />
                <Text style={styles.emptyTxt}>{t("No sessions yet. Start your first!")}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("NEW SESSION")}
                  testID="empty-new-session"
                  onPress={() => void createDated()}
                  disabled={creating}
                  style={press("primary", styles.emptyCta, { disabled: creating })}
                >
                  <Text style={styles.emptyCtaTxt}>{creating ? t("CREATING...") : t("NEW SESSION")}</Text>
                </Pressable>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`workout-${item.id}`}
              style={press("surface", styles.sessionCard)}
              onPress={() => {
                if (item.activity && typeof item.activity === "object") {
                  router.push(`/record/${item.id}` as Href);
                  return;
                }
                router.push(`/workout/${item.id}` as Href);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.sessionTitle}>{item.title}</Text>
                <Text style={styles.sessionMeta} testID={`workout-meta-${item.id}`}>{sessionMeta(item)}</Text>
              </View>
              <Ionicons name="chevron-forward" color={colors.textMuted} size={20} />
            </Pressable>
          )}
        />
      ) : (
        <>
          <View style={[styles.searchWrap, searchField.style]} {...searchField.hover}>
            <Ionicons name="search" color={colors.textMuted} size={18} />
            <TextInput
              testID="library-search"
              value={query}
              onChangeText={setQuery}
              placeholder={t("Search exercises or equipment")}
              placeholderTextColor={colors.textDim}
              style={styles.searchInput}
              returnKeyType="search"
              {...searchField.focus}
            />
            {query ? (
              <Pressable
                onPress={() => setQuery("")}
                accessibilityRole="button"
                accessibilityLabel={t("Clear exercise search")}
                hitSlop={8}
                style={press("ghost", styles.clearSearch)}
              >
                <Ionicons name="close-circle" color={colors.textMuted} size={18} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsRow}
            contentContainerStyle={styles.chipsContent}
          >
            <Chip label={t("ALL")} active={!category} onPress={() => setCategory(null)} testID="chip-all" />
            {categories.map((c) => (
              <Chip
                key={c}
                testID={`chip-${c}`}
                label={t(c.toUpperCase())}
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
            <Chip label={t("ALL MUSCLES")} active={!muscle} onPress={() => setMuscle(null)} testID="muscle-all" />
            {muscles.map((m) => (
              <Chip
                key={m.slug}
                testID={`muscle-${m.slug}`}
                label={t(MUSCLE_NAMES[m.slug as MuscleSlug] ?? m.name)}
                active={muscle === m.slug}
                onPress={() => setMuscle(muscle === m.slug ? null : m.slug)}
              />
            ))}
          </ScrollView>
          <FlatList
            data={filtered}
            keyExtractor={(e) => e.id ?? e.slug}
            contentContainerStyle={styles.listPad}
            ListHeaderComponent={
              selectedExercises.length > 0 ? (
                <View style={styles.selectionBar} testID="selected-count">
                  <View style={styles.selectionCopy}>
                    <Text style={styles.selectionCount}>
                      {t("{count} SELECTED", { count: selectedExercises.length })}
                    </Text>
                    <Text style={styles.selectionNames} numberOfLines={1}>
                      {selectedExercises.map((exercise) => exercise.name).join(" · ")}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setSelectedSlugs([])}
                    accessibilityRole="button"
                    accessibilityLabel={t("Clear selected exercises")}
                    style={press("ghost", styles.clearSelection)}
                  >
                    <Text style={styles.clearSelectionText}>{t("CLEAR")}</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.libraryHint}>{t("SELECT EXERCISES TO BUILD A SESSION")}</Text>
              )
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={40} color={colors.textDim} />
                <Text style={styles.emptyTxt}>{t("No exercises match these filters.")}</Text>
                <Pressable
                  style={press("ghost", styles.resetFilters)}
                  onPress={() => {
                    setQuery("");
                    setCategory(null);
                    setMuscle(null);
                  }}
                >
                  <Text style={styles.resetFiltersText}>{t("RESET FILTERS")}</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => (
              <View
                style={[
                  styles.exCard,
                  selectedSlugs.includes(item.slug) && styles.exCardSelected,
                ]}
              >
                <Pressable
                  style={press("surface", styles.exSelect)}
                  testID={`exercise-${item.slug}`}
                  onPress={() => toggleExercise(item.slug)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selectedSlugs.includes(item.slug) }}
                  accessibilityLabel={t("Select {name}", { name: item.name })}
                >
                  <View style={styles.exIcon}>
                    <Ionicons
                      name={selectedSlugs.includes(item.slug) ? "checkmark" : "fitness"}
                      color={colors.text}
                      size={20}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exName}>{item.name}</Text>
                    <Text style={styles.exMeta}>
                      {item.equipment ? t(item.equipment) : "—"} · {t(item.difficulty ?? "")}
                    </Text>
                  </View>
                  <Text style={styles.exBadge}>{t(item.category ?? "")}</Text>
                </Pressable>
                <Pressable
                  testID={`exercise-demo-${item.slug}`}
                  style={press("primary", styles.exDemo)}
                  onPress={() => setDemoExercise(item)}
                  accessibilityRole="button"
                  accessibilityLabel={t("Open {name} exercise demo", { name: item.name })}
                >
                  <Ionicons name="play" color={colors.brandOn} size={14} />
                </Pressable>
              </View>
            )}
          />
        </>
      )}

      <Pressable
        testID="fab-new-workout"
        style={press("primary", [styles.fab, creating && { opacity: 0.6 }], { disabled: creating })}
        onPress={openNewSession}
        disabled={creating}
      >
        <Ionicons name="add" color={colors.brandOn} size={28} />
        <Text style={styles.fabTxt}>
          {tab === "library" && selectedSlugs.length > 0
            ? t("START WITH {count}", { count: selectedSlugs.length })
            : t("NEW SESSION")}
        </Text>
      </Pressable>

      <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModal(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{t("NEW SESSION")}</Text>
            {selectedExercises.length > 0 ? (
              <View style={styles.planSummary}>
                <Text style={styles.planSummaryCount}>
                  {t(selectedExercises.length === 1 ? "{count} PLANNED EXERCISE" : "{count} PLANNED EXERCISES", { count: selectedExercises.length })}
                </Text>
                <Text style={styles.planSummaryNames} numberOfLines={2}>
                  {selectedExercises.map((exercise) => exercise.name).join(" · ")}
                </Text>
              </View>
            ) : null}
            <TextInput
              testID="input-workout-title"
              placeholder={t("Session name")}
              placeholderTextColor={colors.textDim}
              style={[styles.sheetInput, titleField.style]}
              value={newTitle}
              onChangeText={setNewTitle}
              autoFocus
              {...titleField.hover}
              {...titleField.focus}
            />
            {createError ? <Text accessibilityRole="alert" style={styles.createError} testID="create-error">{createError}</Text> : null}
            <Pressable
              style={press("primary", [styles.sheetCta, (!newTitle.trim() || creating) && styles.sheetCtaDisabled], { disabled: !newTitle.trim() || creating })}
              onPress={startWorkout}
              disabled={!newTitle.trim() || creating}
              testID="submit-workout-btn"
            >
              <Text style={styles.sheetCtaTxt}>{creating ? t("CREATING...") : t("START SESSION")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <ExerciseDemoModal
        exercise={demoExercise}
        onClose={() => setDemoExercise(null)}
        closeStyle={press("ghost")}
        watchStyle={press("primary")}
      />
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
  const press = usePressFeedback();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={press("chip", [styles.chip, active && styles.chipActive], { preserveBorder: active })}
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
  title: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  segment: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.md,
  },
  segBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  segBtnActive: { backgroundColor: colors.surface2 },
  segTxt: { color: colors.textMuted, fontWeight: "400", letterSpacing: 0, fontSize: 13 },
  segTxtActive: { color: colors.text, fontWeight: "600" },
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
  chipActive: { borderColor: colors.text, backgroundColor: colors.surface2 },
  chipTxt: { color: colors.textMuted, fontWeight: "700", fontSize: 11, letterSpacing: 1 },
  chipTxtActive: { color: colors.text },
  searchWrap: {
    minHeight: 44,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: spacing.sm },
  listPad: { padding: spacing.lg, paddingBottom: 140 },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    ...card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  sessionTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sessionMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  exCard: {
    flexDirection: "row",
    alignItems: "center",
    ...card,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  exCardSelected: { borderColor: colors.text, backgroundColor: colors.surface2 },
  exSelect: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  exIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  exName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  exMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2, textTransform: "capitalize" },
  exBadge: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  exDemo: {
    width: 44,
    height: 44,
    marginRight: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  libraryHint: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: spacing.md,
  },
  selectionBar: {
    minHeight: 52,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface2,
    borderLeftWidth: 3,
    borderLeftColor: colors.text,
  },
  selectionCopy: { flex: 1, minWidth: 0 },
  selectionCount: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  selectionNames: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  clearSelection: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  clearSelectionText: { color: colors.text, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  empty: { alignItems: "center", padding: spacing.xxxl, gap: spacing.md },
  emptyTxt: { color: colors.textMuted },
  resetFilters: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.sm },
  resetFiltersText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  fab: {
    position: "absolute",
    bottom: 82,
    left: spacing.lg,
    right: spacing.lg,
    minHeight: 52,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
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
  planSummary: {
    backgroundColor: colors.surface2,
    borderLeftWidth: 3,
    borderLeftColor: colors.text,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  planSummaryCount: { color: colors.text, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  planSummaryNames: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  sheetInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetCta: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  sheetCtaDisabled: { opacity: 0.45 },
  sheetCtaTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 2 },
  createError: { color: colors.error, fontSize: 12, marginBottom: spacing.md },
  errorBanner: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  errorPad: { paddingHorizontal: spacing.lg },
  retryBtn: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  clearSearch: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  retryTxt: { color: colors.text, fontWeight: "800" },
  emptyCta: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCtaTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 1 },
});
