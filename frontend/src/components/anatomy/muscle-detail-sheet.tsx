import React, { useState } from "react";
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
import { loadState, type LoadState } from "./muscle-region";
import { colors, spacing, radius } from "../../theme";

// Theme aliases for readability
const card = colors.surface;
const background = colors.surface2;
const muted = colors.textMuted;
const full = radius.pill;

type DetailTab = "overview" | "exercises" | "circuits";

export type MuscleDetailSheetProps = {
  muscle: MuscleSlug;
  stats?: MuscleStats;
  recommendations?: MuscleRecommendations;
  loading: boolean;
  error: string | null;
  regenerating: boolean;
  aiCircuit: AiCircuit | null;
  onExerciseSelect: (exercise: RecommendationExercise) => void;
  onRegenerate: () => void;
  onClose: () => void;
};

const RECOVERY_LABELS: Record<MuscleStats["recovery_state"], string> = {
  ready: "Ready to train",
  recovering: "Recovering",
  high_load: "High load",
  untrained: "Not recently trained",
};

const RECOVERY_COLORS: Record<MuscleStats["recovery_state"], string> = {
  ready: "#4CAF50",
  recovering: "#FF9800",
  high_load: "#F44336",
  untrained: "#9E9E9E",
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
}: {
  exercise: RecommendationExercise;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.exerciseCard}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Select ${exercise.name}`}
    >
      <View style={styles.exerciseInfo}>
        <Text style={styles.exerciseName}>{exercise.name}</Text>
        <View style={styles.exerciseMeta}>
          {exercise.equipment && (
            <Text style={styles.exerciseTag}>{exercise.equipment}</Text>
          )}
          {exercise.difficulty && (
            <Text style={styles.exerciseTag}>{exercise.difficulty}</Text>
          )}
        </View>
      </View>
      <Ionicons name="play-circle-outline" size={28} color={colors.accent} />
    </Pressable>
  );
}

function CircuitCard({
  circuit,
  isAi,
  onExerciseSelect,
}: {
  circuit: Circuit | AiCircuit;
  isAi?: boolean;
  onExerciseSelect: (slug: string) => void;
}) {
  return (
    <View style={[styles.circuitCard, isAi && styles.circuitCardAi]}>
      <View style={styles.circuitHeader}>
        <Text style={styles.circuitName}>{circuit.name}</Text>
        {isAi && (
          <View style={styles.aiBadge}>
            <Ionicons name="sparkles" size={12} color="#FFF" />
            <Text style={styles.aiBadgeText}>AI</Text>
          </View>
        )}
      </View>
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
                {item.sets}×{item.reps_min}
                {item.reps_min !== item.reps_max ? `-${item.reps_max}` : ""} |{" "}
                {item.rest_sec}s rest
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
  onRegenerate,
  onClose,
}: MuscleDetailSheetProps) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const muscleName = MUSCLE_NAMES[muscle];
  const state = stats ? loadState(stats.load_percent) : "untrained";

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

  const renderOverview = () => {
    if (!stats) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="barbell-outline" size={48} color={muted} />
          <Text style={styles.emptyText}>
            No training recorded for this muscle in the last 7 days.
          </Text>
        </View>
      );
    }

    const lastTrained = stats.last_trained_at
      ? new Date(stats.last_trained_at).toLocaleDateString()
      : "Never";

    return (
      <View style={styles.overviewContent}>
        <View style={styles.statusBadge}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: RECOVERY_COLORS[stats.recovery_state] },
            ]}
          />
          <Text style={styles.statusText}>
            {RECOVERY_LABELS[stats.recovery_state]}
          </Text>
        </View>

        <View style={styles.statsGrid}>
          <StatRow label="Sets (7 days)" value={String(stats.sets_7d)} />
          <StatRow label="Load" value={`${stats.load_percent}%`} />
          <StatRow label="Status" value={LOAD_LABELS[state]} />
          <StatRow label="Last trained" value={lastTrained} />
        </View>
      </View>
    );
  };

  const renderExercises = () => {
    const primary = recommendations?.primary ?? [];
    const secondary = recommendations?.secondary ?? [];

    if (primary.length === 0 && secondary.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="fitness-outline" size={48} color={muted} />
          <Text style={styles.emptyText}>
            No exercises match the selected equipment.
          </Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.exerciseList}>
        {primary.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Primary Exercises</Text>
            {primary.map((exercise) => (
              <ExerciseCard
                key={exercise.slug}
                exercise={exercise}
                onPress={() => onExerciseSelect(exercise)}
              />
            ))}
          </>
        )}

        {secondary.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Secondary (Compound)</Text>
            {secondary.map((exercise) => (
              <ExerciseCard
                key={exercise.slug}
                exercise={exercise}
                onPress={() => onExerciseSelect(exercise)}
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
      <ScrollView style={styles.circuitList}>
        {/* Deterministic circuits first */}
        {circuits.map((circuit, index) => (
          <CircuitCard
            key={`circuit-${index}`}
            circuit={circuit}
            onExerciseSelect={handleCircuitExerciseSelect}
          />
        ))}

        {/* AI-generated circuit */}
        {aiCircuit && (
          <CircuitCard
            circuit={aiCircuit}
            isAi
            onExerciseSelect={handleCircuitExerciseSelect}
          />
        )}

        {/* Regenerate button */}
        <Pressable
          style={[styles.regenerateButton, regenerating && styles.buttonDisabled]}
          onPress={onRegenerate}
          disabled={regenerating}
          accessibilityRole="button"
          accessibilityLabel="Generate AI circuit"
        >
          {regenerating ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Ionicons name="sparkles" size={18} color="#FFF" />
          )}
          <Text style={styles.regenerateText}>
            {regenerating ? "Generating..." : "Generate AI Circuit"}
          </Text>
        </Pressable>

        {/* Combination exercises */}
        {combinations.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Combination Exercises</Text>
            {combinations.map((exercise) => (
              <ExerciseCard
                key={exercise.slug}
                exercise={exercise}
                onPress={() => onExerciseSelect(exercise)}
              />
            ))}
          </>
        )}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{muscleName}</Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TabButton
          label="Overview"
          active={tab === "overview"}
          onPress={() => setTab("overview")}
        />
        <TabButton
          label="Exercises"
          active={tab === "exercises"}
          onPress={() => setTab("exercises")}
        />
        <TabButton
          label="Circuits"
          active={tab === "circuits"}
          onPress={() => setTab("circuits")}
        />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>Loading recommendations...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorState}>
            <Ionicons name="alert-circle-outline" size={48} color="#F44336" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={onRegenerate}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Retry</Text>
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
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.xs,
  },
  tabButtonActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  tabLabel: {
    fontSize: 14,
    color: muted,
  },
  tabLabelActive: {
    color: colors.accent,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    padding: spacing.md,
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
    backgroundColor: colors.accent,
    borderRadius: radius.md,
  },
  retryText: {
    color: "#FFF",
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
  overviewContent: {
    flex: 1,
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
    backgroundColor: background,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
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
    borderColor: colors.accent,
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
    backgroundColor: colors.accent,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    gap: 4,
  },
  aiBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFF",
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
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  regenerateText: {
    color: "#FFF",
    fontWeight: "600",
  },
});
