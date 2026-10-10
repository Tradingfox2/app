import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type {
  MuscleSlug,
  MuscleStats,
  MuscleRecommendations,
  RecommendationExercise,
  AiCircuit,
  Circuit,
} from "./muscle-types";
import { MUSCLE_NAMES } from "./anatomy-artwork";
import { MUSCLE_KNOWLEDGE } from "./muscle-knowledge";
import { localizeMuscleKnowledge } from "./muscle-knowledge-locales";
import { ANTAGONISTS, SYNERGISTS } from "./muscle-relations";
import { loadState, type LoadState } from "./muscle-region";
import { colors, fonts, spacing, radius } from "../../theme";
import { ExerciseDemoModal } from "../exercises/exercise-demo-modal";
import { useI18n } from "../../i18n";

// Theme aliases for readability
const card = colors.surface;
const background = colors.surface2;
const muted = colors.textMuted;
const full = radius.pill;

type DetailTab = "overview" | "exercises" | "circuits";

function uniqueExercises(exercises: RecommendationExercise[]) {
  return exercises.filter(
    (exercise, index, list) =>
      list.findIndex((candidate) => candidate.slug === exercise.slug) === index,
  );
}

export type MuscleDetailSheetProps = {
  muscle: MuscleSlug;
  stats?: MuscleStats;
  recommendations?: MuscleRecommendations;
  loading: boolean;
  error: string | null;
  regenerating: boolean;
  aiCircuit: AiCircuit | null;
  onExerciseSelect: (exercise: RecommendationExercise) => void;
  onPartnerPress?: (muscle: MuscleSlug) => void;
  onRetryRecommendations: () => void;
  onRegenerate: () => void;
  onClose: () => void;
  /** Queue one or more exercise slugs into the live session (creates one if needed). */
  onAddToWorkout?: (slugs: string[], label: string) => void;
  /** `slugs.join("|")` of the add currently in flight — used to show a spinner. */
  addingKey?: string | null;
};

const RECOVERY_LABELS: Record<MuscleStats["recovery_state"], string> = {
  ready: "Ready to train",
  recovering: "Recovering",
  high_load: "High load",
  untrained: "Not recently trained",
};

const RECOVERY_COLORS: Record<MuscleStats["recovery_state"], string> = {
  ready: colors.success,
  recovering: colors.warning,
  high_load: colors.error,
  untrained: colors.textDim,
};

const LOAD_LABELS: Record<LoadState, string> = {
  untrained: "No recent activity",
  low: "Light load",
  productive: "Productive load",
  high: "High load",
  overreaching: "Overreaching",
};

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.tabButton, active && styles.tabButtonActive]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function ExerciseCard({
  exercise,
  onPress,
  onDemo,
  onAdd,
  adding,
}: {
  exercise: RecommendationExercise;
  onPress: () => void;
  onDemo: () => void;
  onAdd?: () => void;
  adding?: boolean;
}) {
  const { t } = useI18n();
  const partners = (exercise.secondary_muscle_slugs ?? []).filter(
    (slug) => slug !== exercise.primary_muscle_slug,
  );

  // Two sibling Pressables (not nested): nested <button> is invalid HTML on web.
  return (
    <View style={styles.exerciseCard}>
      <Pressable
        style={styles.exercisePreview}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("Preview {name} on the body", { name: exercise.name })}
      >
        <View style={styles.exerciseInfo}>
          <Text style={styles.exerciseName}>{exercise.name}</Text>
          <View style={styles.exerciseMeta}>
            {exercise.equipment && (
              <Text style={styles.exerciseTag}>{t(exercise.equipment)}</Text>
            )}
            {exercise.difficulty && (
              <Text style={styles.exerciseTag}>{t(exercise.difficulty)}</Text>
            )}
            {partners.map((slug) => (
              <Text key={slug} style={[styles.exerciseTag, styles.partnerTag]}>
                + {t(MUSCLE_NAMES[slug])}
              </Text>
            ))}
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onDemo}
        hitSlop={6}
        style={styles.demoBtn}
        accessibilityRole="button"
        accessibilityLabel={t("Open {name} exercise demo", { name: exercise.name })}
      >
        <Ionicons name="play" size={16} color={colors.brandOn} />
      </Pressable>
      {onAdd ? (
        <Pressable
          onPress={onAdd}
          disabled={adding}
          hitSlop={6}
          style={[styles.addBtn, adding && styles.buttonDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t("Add {name} to workout", { name: exercise.name })}
          testID={`add-exercise-${exercise.slug}`}
        >
          {adding ? (
            <ActivityIndicator size="small" color={colors.brandOn} />
          ) : (
            <Ionicons name="add" size={22} color={colors.brandOn} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function CircuitCard({
  circuit,
  isAi,
  onExerciseSelect,
  onAdd,
  adding,
}: {
  circuit: Circuit | AiCircuit;
  isAi?: boolean;
  onExerciseSelect: (slug: string) => void;
  onAdd?: () => void;
  adding?: boolean;
}) {
  const { t, formatNumber } = useI18n();
  return (
    <View style={[styles.circuitCard, isAi && styles.circuitCardAi]}>
      <View style={styles.circuitHeader}>
        <Text style={styles.circuitName}>{circuit.name}</Text>
        {isAi && (
          <View style={styles.aiBadge}>
            <Ionicons name="sparkles" size={12} color={colors.text} />
            <Text style={styles.aiBadgeText}>AI</Text>
          </View>
        )}
      </View>
      {onAdd ? (
        <Pressable
          onPress={onAdd}
          disabled={adding}
          style={[styles.circuitAddBtn, adding && styles.buttonDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t("Add {name} to workout", { name: circuit.name })}
        >
          {adding ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Ionicons name="add-circle" size={18} color={colors.text} />
          )}
          <Text style={styles.circuitAddText}>
            {t("Add {count} exercises to workout", { count: formatNumber(circuit.items.length) })}
          </Text>
        </Pressable>
      ) : null}
      {circuit.rationale && (
        <Text style={styles.circuitRationale}>{circuit.rationale}</Text>
      )}
      <View style={styles.circuitItems}>
        {circuit.items.map((item, index) => (
          <Pressable
            key={`${item.exercise_slug}-${index}`}
            style={styles.circuitItem}
            onPress={() => onExerciseSelect(item.exercise_slug)}
            accessibilityRole="button"
          >
            <Text style={styles.circuitItemIndex}>{index + 1}</Text>
            <View style={styles.circuitItemInfo}>
              <Text style={styles.circuitItemName}>
                {item.name || item.exercise_slug}
              </Text>
              <Text style={styles.circuitItemPrescription}>
                {formatNumber(item.sets)}×{formatNumber(item.reps_min)}
                {item.reps_min !== item.reps_max ? `-${formatNumber(item.reps_max)}` : ""} |{" "}
                {t("{seconds}s rest", { seconds: formatNumber(item.rest_sec) })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={muted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function MuscleDetailSheet({
  muscle,
  stats,
  recommendations,
  loading,
  error,
  regenerating,
  aiCircuit,
  onExerciseSelect,
  onPartnerPress,
  onRetryRecommendations,
  onRegenerate,
  onClose,
  onAddToWorkout,
  addingKey,
}: MuscleDetailSheetProps) {
  const { locale, t, formatDate, formatNumber } = useI18n();
  const [tab, setTab] = useState<DetailTab>("exercises");
  const [demoExercise, setDemoExercise] =
    useState<RecommendationExercise | null>(null);
  const isAdding = (slugs: string[]) => addingKey === slugs.join("|");
  const addOne = onAddToWorkout
    ? (exercise: RecommendationExercise) => () =>
        onAddToWorkout([exercise.slug], exercise.name)
    : undefined;
  const addCircuit = onAddToWorkout
    ? (circuit: Circuit | AiCircuit) => () =>
        onAddToWorkout(
          circuit.items.map((item) => item.exercise_slug),
          circuit.name,
        )
    : undefined;
  const muscleName = t(MUSCLE_NAMES[muscle]);
  const state = stats ? loadState(stats.load_percent) : "untrained";
  const partners = [
    ...SYNERGISTS[muscle],
    ANTAGONISTS[muscle],
  ].filter((slug, index, list) => list.indexOf(slug) === index);

  useEffect(() => {
    setTab("exercises");
  }, [muscle]);

  const handleCircuitExerciseSelect = (slug: string) => {
    // Find the exercise in recommendations to get full data
    const allExercises = [
      ...(recommendations?.primary ?? []),
      ...(recommendations?.secondary ?? []),
      ...(recommendations?.combinations ?? []),
    ];
    const exercise = allExercises.find((e) => e.slug === slug);
    if (exercise) {
      onExerciseSelect(exercise);
    }
  };

  const renderPartnerRow = () => (
    <View style={styles.partnerBlock}>
      <Text style={styles.sectionTitle}>{t("Works with")}</Text>
      <View style={styles.partnerRow}>
        {partners.map((slug) => {
          const isAntagonist = slug === ANTAGONISTS[muscle];
          return (
            <Pressable
              key={slug}
              style={[
                styles.partnerChip,
                isAntagonist && styles.partnerChipAntagonist,
              ]}
              onPress={() => onPartnerPress?.(slug)}
              accessibilityRole="button"
              accessibilityLabel={t("Select {name}", { name: t(MUSCLE_NAMES[slug]) })}
            >
              <View
                style={[
                  styles.partnerDot,
                  {
                    backgroundColor: isAntagonist
                      ? colors.blaze
                      : colors.volt,
                  },
                ]}
              />
              <Text style={styles.partnerChipText}>{t(MUSCLE_NAMES[slug])}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderOverview = () => {
    const lastTrained = stats?.last_trained_at
      ? formatDate(stats.last_trained_at)
      : t("Never");

    const know = localizeMuscleKnowledge(
      muscle,
      locale,
      MUSCLE_KNOWLEDGE[muscle],
    );
    const setsDone = stats?.sets_7d ?? 0;
    const [setsMin, setsMax] = know.sets;
    const weeklyVerdict =
      setsDone === 0
        ? t("Not trained this week — aim for {frequency}.", {
            frequency: t("{min}–{max}×/week", {
              min: formatNumber(know.sessions[0]),
              max: formatNumber(know.sessions[1]),
            }),
          })
        : setsDone < setsMin
          ? t("{done} sets so far — {remaining} more reach the productive range.", { done: formatNumber(setsDone), remaining: formatNumber(setsMin - setsDone) })
          : setsDone <= setsMax
            ? t("{done} sets this week — you are in the productive {min}–{max} range.", { done: formatNumber(setsDone), min: formatNumber(setsMin), max: formatNumber(setsMax) })
            : t("{done} sets this week — above {max}; watch recovery or deload.", { done: formatNumber(setsDone), max: formatNumber(setsMax) });

    return (
      <ScrollView key={`${muscle}-overview`} style={styles.overviewContent}>
        {renderPartnerRow()}

        <View style={styles.knowCard} testID="muscle-knowledge">
          <Text style={styles.knowRole}>{know.role}</Text>
          <Text style={styles.knowHeading}>{t("WHY TRAIN IT")}</Text>
          <Text style={styles.knowBody}>{know.why}</Text>
          <Text style={styles.knowHeading}>{t("COACH INSIGHT")}</Text>
          <Text style={styles.knowBody}>{know.insight}</Text>
          <Text style={styles.knowHeading}>{t("WEEKLY PRESCRIPTION")}</Text>
          <View style={styles.knowPills}>
            <View style={styles.knowPill}>
              <Ionicons name="calendar-outline" size={12} color={colors.volt} />
              <Text style={styles.knowPillText}>
                {t("{min}–{max}×/week", {
                  min: formatNumber(know.sessions[0]),
                  max: formatNumber(know.sessions[1]),
                })}
              </Text>
            </View>
            <View style={styles.knowPill}>
              <Ionicons name="layers-outline" size={12} color={colors.volt} />
              <Text style={styles.knowPillText}>
                {t("{min}–{max} hard sets/week", {
                  min: formatNumber(know.sets[0]),
                  max: formatNumber(know.sets[1]),
                })}
              </Text>
            </View>
            <View style={styles.knowPill}>
              <Ionicons name="repeat-outline" size={12} color={colors.volt} />
              <Text style={styles.knowPillText}>{t("{range} reps", { range: know.reps })}</Text>
            </View>
            <View style={styles.knowPill}>
              <Ionicons name="time-outline" size={12} color={colors.volt} />
              <Text style={styles.knowPillText}>
                {t("{hours} h between sessions", {
                  hours: formatNumber(know.restHours),
                })}
              </Text>
            </View>
          </View>
          <Text style={styles.knowVerdict}>{weeklyVerdict}</Text>
        </View>

        {stats ? (
          <>
            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: RECOVERY_COLORS[stats.recovery_state] },
                ]}
              />
              <Text style={styles.statusText}>
                {t(RECOVERY_LABELS[stats.recovery_state])}
              </Text>
            </View>

            <View style={styles.statsGrid}>
              <StatRow label={t("Sets (7 days)")} value={formatNumber(stats.sets_7d)} />
              <StatRow label={t("Load")} value={`${formatNumber(stats.load_percent)}%`} />
              <StatRow label={t("Status")} value={t(LOAD_LABELS[state])} />
              <StatRow label={t("Last trained")} value={lastTrained} />
            </View>
            <Text style={styles.loadNote}>{t("Load is this muscle's share of logged volume. It is not a body scan.")}</Text>
          </>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="barbell-outline" size={36} color={muted} />
            <Text style={styles.emptyText}>
              {t("No training recorded for this muscle in the last 7 days.")}
            </Text>
          </View>
        )}
      </ScrollView>
    );
  };

  const renderExercises = () => {
    const primary = uniqueExercises(recommendations?.primary ?? []);
    const secondary = uniqueExercises(recommendations?.secondary ?? []);
    const combinations = uniqueExercises(recommendations?.combinations ?? []);

    if (
      primary.length === 0 &&
      secondary.length === 0 &&
      combinations.length === 0
    ) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="fitness-outline" size={48} color={muted} />
          <Text style={styles.emptyText}>
            {t("No exercises match the selected equipment.")}
          </Text>
        </View>
      );
    }

    return (
      <ScrollView key={`${muscle}-exercises`} style={styles.exerciseList}>
        {renderPartnerRow()}

        {onAddToWorkout ? (
          <Text style={styles.hintText}>
            {t("Tap a card to preview it on the body · tap + to add it to your session")}
          </Text>
        ) : null}

        {combinations.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t("Combination Exercises")}</Text>
            {combinations.map((exercise) => (
              <ExerciseCard
                key={exercise.slug}
                exercise={exercise}
                onPress={() => onExerciseSelect(exercise)}
                onDemo={() => setDemoExercise(exercise)}
                onAdd={addOne?.(exercise)}
                adding={isAdding([exercise.slug])}
              />
            ))}
          </>
        )}

        {primary.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t("Primary Exercises")}</Text>
            {primary.map((exercise) => (
              <ExerciseCard
                key={exercise.slug}
                exercise={exercise}
                onPress={() => onExerciseSelect(exercise)}
                onDemo={() => setDemoExercise(exercise)}
                onAdd={addOne?.(exercise)}
                adding={isAdding([exercise.slug])}
              />
            ))}
          </>
        )}

        {secondary.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t("Secondary (Compound)")}</Text>
            {secondary.map((exercise) => (
              <ExerciseCard
                key={exercise.slug}
                exercise={exercise}
                onPress={() => onExerciseSelect(exercise)}
                onDemo={() => setDemoExercise(exercise)}
                onAdd={addOne?.(exercise)}
                adding={isAdding([exercise.slug])}
              />
            ))}
          </>
        )}
      </ScrollView>
    );
  };

  const renderCircuits = () => {
    const circuits = recommendations?.circuits ?? [];
    const combinations = recommendations?.combinations ?? [];

    return (
      <ScrollView key={`${muscle}-circuits`} style={styles.circuitList}>
        {/* Deterministic circuits first */}
        {circuits.map((circuit, index) => (
          <CircuitCard
            key={`circuit-${index}`}
            circuit={circuit}
            onExerciseSelect={handleCircuitExerciseSelect}
            onAdd={addCircuit?.(circuit)}
            adding={isAdding(circuit.items.map((i) => i.exercise_slug))}
          />
        ))}

        {/* AI-generated circuit */}
        {aiCircuit && (
          <CircuitCard
            circuit={aiCircuit}
            isAi
            onExerciseSelect={handleCircuitExerciseSelect}
            onAdd={addCircuit?.(aiCircuit)}
            adding={isAdding(aiCircuit.items.map((i) => i.exercise_slug))}
          />
        )}

        {/* Regenerate button */}
        <Pressable
          style={[styles.regenerateButton, regenerating && styles.buttonDisabled]}
          onPress={onRegenerate}
          disabled={regenerating}
          accessibilityRole="button"
          accessibilityLabel={t("Generate AI circuit")}
        >
          {regenerating ? (
            <ActivityIndicator size="small" color={colors.brandOn} />
          ) : (
            <Ionicons name="sparkles" size={18} color={colors.brandOn} />
          )}
          <Text style={styles.regenerateText}>
            {regenerating ? t("Generating...") : t("Generate AI Circuit")}
          </Text>
        </Pressable>

        {/* Combination exercises stay on Circuits too for existing users */}
        {combinations.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t("Combination Exercises")}</Text>
            {combinations.map((exercise) => (
              <ExerciseCard
                key={exercise.slug}
                exercise={exercise}
                onPress={() => onExerciseSelect(exercise)}
                onDemo={() => setDemoExercise(exercise)}
                onAdd={addOne?.(exercise)}
                adding={isAdding([exercise.slug])}
              />
            ))}
          </>
        )}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Compact command bar keeps the selected muscle and its actions visible. */}
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{muscleName}</Text>
          <Text style={styles.titleMeta}>
            {t("{min}–{max}×/week", {
              min: formatNumber(MUSCLE_KNOWLEDGE[muscle].sessions[0]),
              max: formatNumber(MUSCLE_KNOWLEDGE[muscle].sessions[1]),
            })}
          </Text>
        </View>

        <View style={styles.tabBar} accessibilityRole="tablist">
          <TabButton
            label={t("Overview")}
            active={tab === "overview"}
            onPress={() => setTab("overview")}
          />
          <TabButton
            label={t("Exercises")}
            active={tab === "exercises"}
            onPress={() => setTab("exercises")}
          />
          <TabButton
            label={t("Circuits")}
            active={tab === "circuits"}
            onPress={() => setTab("circuits")}
          />
        </View>

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("Close")}
          hitSlop={12}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={colors.text} />
            <Text style={styles.loadingText}>{t("Loading recommendations...")}</Text>
          </View>
        ) : error ? (
          <View style={styles.errorState}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={onRetryRecommendations}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>{t("Retry")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {tab === "overview" && renderOverview()}
            {tab === "exercises" && renderExercises()}
            {tab === "circuits" && renderCircuits()}
          </>
        )}
      </View>
      <ExerciseDemoModal
        exercise={demoExercise}
        onClose={() => setDemoExercise(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
  },
  titleBlock: {
    minWidth: 104,
    flexShrink: 1,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: "900",
    color: colors.text,
    letterSpacing: 0,
  },
  titleMeta: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 12,
  },
  tabBar: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    gap: 2,
  },
  tabButton: {
    minHeight: 34,
    justifyContent: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  tabButtonActive: {
    backgroundColor: colors.surface2,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: muted,
  },
  tabLabelActive: {
    color: colors.text,
    fontWeight: "900",
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: spacing.md,
    color: muted,
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  errorText: {
    marginTop: spacing.md,
    color: muted,
    textAlign: "center",
  },
  retryButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
  },
  retryText: {
    color: colors.brandOn,
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyText: {
    marginTop: spacing.md,
    color: muted,
    textAlign: "center",
    lineHeight: 22,
  },
  loadNote: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  overviewContent: {
    flex: 1,
  },
  knowCard: {
    backgroundColor: background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.volt,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  knowRole: { color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: spacing.xs },
  knowHeading: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  knowBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  knowPills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  knowPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  knowPillText: { color: colors.text, fontSize: 11, fontWeight: "700" },
  knowVerdict: {
    marginTop: spacing.sm,
    color: colors.volt,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: background,
    borderRadius: full,
    marginBottom: spacing.lg,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  statusText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "500",
  },
  statsGrid: {
    backgroundColor: background,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statLabel: {
    fontSize: 14,
    color: muted,
  },
  statValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "600",
  },
  exerciseList: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  exerciseCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: background,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 60,
  },
  exercisePreview: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  demoBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  hintText: {
    color: muted,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  circuitAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: full,
    borderWidth: 1,
    borderColor: colors.text,
    backgroundColor: colors.surface2,
    marginBottom: spacing.sm,
  },
  circuitAddText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 4,
  },
  exerciseMeta: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  exerciseTag: {
    fontSize: 12,
    color: muted,
    backgroundColor: card,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    textTransform: "capitalize",
  },
  partnerTag: {
    color: colors.info,
    textTransform: "none",
  },
  partnerBlock: {
    marginBottom: spacing.sm,
  },
  partnerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  partnerChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: background,
    borderRadius: full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  partnerChipAntagonist: {
    borderColor: colors.warning,
  },
  partnerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  partnerChipText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: "600",
  },
  circuitList: {
    flex: 1,
  },
  circuitCard: {
    backgroundColor: background,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  circuitCardAi: {
    borderWidth: 1,
    borderColor: colors.text,
  },
  circuitHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  circuitName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    gap: 4,
  },
  aiBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.text,
  },
  circuitRationale: {
    fontSize: 13,
    color: muted,
    fontStyle: "italic",
    marginBottom: spacing.sm,
  },
  circuitItems: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  circuitItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  circuitItemIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: card,
    textAlign: "center",
    lineHeight: 24,
    fontSize: 12,
    fontWeight: "700",
    color: muted,
    marginRight: spacing.sm,
  },
  circuitItemInfo: {
    flex: 1,
  },
  circuitItemName: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
  },
  circuitItemPrescription: {
    fontSize: 12,
    color: muted,
  },
  regenerateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  regenerateText: {
    color: colors.brandOn,
    fontWeight: "600",
  },
});
