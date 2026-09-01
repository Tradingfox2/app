import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  AccessibilityInfo,
  PanResponder,
  Animated,
  Dimensions,
} from "react-native";
import type {
  MuscleSlug,
  BodySide,
  ActivationMap,
  MuscleHeatmapData,
  MuscleRecommendations,
  RecommendationExercise,
  AiCircuit,
} from "./muscle-types";
import { AnatomyBody } from "./anatomy-body";
import { MuscleDetailSheet } from "./muscle-detail-sheet";
import { SegmentedControl } from "./segmented-control";
import { api } from "../../api";
import { colors, spacing } from "../../theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_THRESHOLD = 45;

export type MuscleExplorerProps = {
  data: MuscleHeatmapData;
  refreshing?: boolean;
  onRefresh?: () => void;
};

export function MuscleExplorer({
  data,
  refreshing,
  onRefresh,
}: MuscleExplorerProps) {
  // View state
  const [side, setSide] = useState<BodySide>("front");
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleSlug | null>(null);
  const [activation, setActivation] = useState<ActivationMap>({});

  // Recommendation state
  const [recommendations, setRecommendations] =
    useState<MuscleRecommendations | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState<
    string | null
  >(null);

  // AI circuit state
  const [aiCircuit, setAiCircuit] = useState<AiCircuit | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Accessibility
  const [reduceMotion, setReduceMotion] = useState(false);

  // Animation
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Check reduced motion preference
  useEffect(() => {
    const checkReduceMotion = async () => {
      const isEnabled = await AccessibilityInfo.isReduceMotionEnabled();
      setReduceMotion(isEnabled);
    };

    checkReduceMotion();

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );

    return () => {
      subscription.remove();
    };
  }, []);

  // Pan responder for swipe navigation
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const { dx, dy } = gestureState;
        return (
          Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5
        );
      },
      onPanResponderRelease: (_, gestureState) => {
        const { dx } = gestureState;
        if (Math.abs(dx) >= SWIPE_THRESHOLD) {
          if (dx < 0) {
            // Swipe left -> show back
            changeSide("back");
          } else {
            // Swipe right -> show front
            changeSide("front");
          }
        }
      },
    }),
  ).current;

  // Animate side change
  const changeSide = useCallback(
    (newSide: BodySide) => {
      if (newSide === side) return;

      if (reduceMotion) {
        setSide(newSide);
        return;
      }

      const direction = newSide === "back" ? -1 : 1;

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: direction * 30,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setSide(newSide);
        slideAnim.setValue(direction * -30);

        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start();
      });
    },
    [side, reduceMotion, fadeAnim, slideAnim],
  );

  // Load recommendations when muscle is selected
  const loadRecommendations = useCallback(async (muscle: MuscleSlug) => {
    setRecommendationsLoading(true);
    setRecommendationsError(null);

    try {
      const result = await api.muscleRecommendations(muscle);
      setRecommendations(result);
    } catch (err) {
      setRecommendationsError(
        err instanceof Error ? err.message : "Failed to load recommendations",
      );
    } finally {
      setRecommendationsLoading(false);
    }
  }, []);

  // Handle muscle selection
  const handleMusclePress = useCallback(
    (muscle: MuscleSlug) => {
      // Clear exercise activation
      setActivation({});
      setAiCircuit(null);

      if (selectedMuscle === muscle) {
        // Toggle off
        setSelectedMuscle(null);
        setRecommendations(null);
      } else {
        setSelectedMuscle(muscle);
        loadRecommendations(muscle);
      }
    },
    [selectedMuscle, loadRecommendations],
  );

  // Handle exercise selection -> activate muscles
  const handleExerciseSelect = useCallback(
    (exercise: RecommendationExercise) => {
      const newActivation: ActivationMap = {};

      // Primary muscle
      if (
        exercise.primary_muscle_slug &&
        exercise.primary_muscle_slug !== "cardio"
      ) {
        newActivation[exercise.primary_muscle_slug] = "primary";
      }

      // Secondary muscles
      if (exercise.secondary_muscle_slugs) {
        for (const slug of exercise.secondary_muscle_slugs) {
          if (!newActivation[slug]) {
            newActivation[slug] = "secondary";
          }
        }
      }

      setActivation(newActivation);

      // Check if we need to switch sides to show activation
      const activatedSlugs = Object.keys(newActivation) as MuscleSlug[];
      const muscleStats = data.muscles ?? {};

      // If no activated muscle is visible on current side, switch
      const visibleOnCurrentSide = activatedSlugs.some((slug) => {
        const stat = muscleStats[slug];
        return stat !== undefined;
      });

      if (!visibleOnCurrentSide && activatedSlugs.length > 0) {
        // Simple heuristic: front-dominant muscles
        const frontMuscles: MuscleSlug[] = [
          "chest",
          "shoulders",
          "biceps",
          "abs",
          "obliques",
          "quads",
        ];
        const backMuscles: MuscleSlug[] = [
          "back",
          "lats",
          "triceps",
          "lower_back",
          "glutes",
          "hamstrings",
          "calves",
        ];

        const hasFront = activatedSlugs.some((s) => frontMuscles.includes(s));
        const hasBack = activatedSlugs.some((s) => backMuscles.includes(s));

        if (hasFront && !hasBack && side === "back") {
          changeSide("front");
        } else if (hasBack && !hasFront && side === "front") {
          changeSide("back");
        }
      }
    },
    [data.muscles, side, changeSide],
  );

  // Handle AI circuit regeneration
  const handleRegenerate = useCallback(async () => {
    if (!selectedMuscle || regenerating) return;

    setRegenerating(true);

    try {
      const circuit = await api.regenerateMuscleCircuit({
        muscle_slug: selectedMuscle,
        goal: "hypertrophy",
        level: "intermediate",
        equipment: [],
      });
      setAiCircuit(circuit);
    } catch {
      // Error is expected when AI service is unavailable
      // Keep deterministic circuits visible
    } finally {
      setRegenerating(false);
    }
  }, [selectedMuscle, regenerating]);

  // Handle detail sheet close
  const handleCloseDetail = useCallback(() => {
    setSelectedMuscle(null);
    setRecommendations(null);
    setActivation({});
    setAiCircuit(null);
  }, []);

  const stats = selectedMuscle ? data.muscles?.[selectedMuscle] : undefined;

  return (
    <View style={styles.container}>
      {/* Segmented control for side selection */}
      <View style={styles.controlBar}>
        <SegmentedControl
          options={[
            { value: "front", label: "Front" },
            { value: "back", label: "Back" },
          ]}
          selected={side}
          onSelect={(value) => changeSide(value as BodySide)}
        />
      </View>

      {/* Anatomy body */}
      <Animated.View
        style={[
          styles.bodyContainer,
          {
            opacity: fadeAnim,
            transform: [{ translateX: slideAnim }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <AnatomyBody
          side={side}
          volumes={data.volumes}
          max={data.max}
          selectedMuscle={selectedMuscle}
          activation={activation}
          interactive
          animateFibers
          reduceMotion={reduceMotion}
          onMusclePress={handleMusclePress}
          width={Math.min(SCREEN_WIDTH - spacing.lg * 2, 360)}
          height={Math.min(SCREEN_WIDTH - spacing.lg * 2, 360) * (760 / 360)}
        />
      </Animated.View>

      {/* Detail sheet (when muscle selected) */}
      {selectedMuscle && (
        <View style={styles.detailSheet}>
          <MuscleDetailSheet
            muscle={selectedMuscle}
            stats={stats}
            recommendations={recommendations ?? undefined}
            loading={recommendationsLoading}
            error={recommendationsError}
            regenerating={regenerating}
            aiCircuit={aiCircuit}
            onExerciseSelect={handleExerciseSelect}
            onRegenerate={handleRegenerate}
            onClose={handleCloseDetail}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  controlBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bodyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.lg,
  },
  detailSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "50%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
});
