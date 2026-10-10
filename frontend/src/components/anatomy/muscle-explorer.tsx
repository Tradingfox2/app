import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  AccessibilityInfo,
  PanResponder,
  Dimensions,
  Pressable,
  Platform,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import type {
  MuscleSlug,
  BodySide,
  ActivationMap,
  MuscleHeatmapData,
  MuscleRecommendations,
  RecommendationExercise,
  AiCircuit,
} from "./muscle-types";
import { MuscleDetailSheet } from "./muscle-detail-sheet";
import { SegmentedControl } from "./segmented-control";
import { MuscleHeatmap } from "../muscle-heatmap";
import {
  activationFromRecommendations,
  combinationActivation,
  isVisibleOnSide,
  MUSCLE_HOME_SIDE,
} from "./muscle-relations";
import { BACK_VIEWBOX, FRONT_VIEWBOX, MUSCLE_NAMES, FRONT_MUSCLES, BACK_MUSCLES } from "./anatomy-artwork";
import { MUSCLE_KNOWLEDGE } from "./muscle-knowledge";
import { localizeMuscleKnowledge } from "./muscle-knowledge-locales";
import { muscleCalloutPlans, readCalloutFacts } from "./callout-geometry";
import { MuscleCalloutLabel, useCalloutSequence } from "./muscle-callout";
import { api } from "../../api";
import { colors, spacing } from "../../theme";
import { useI18n } from "../../i18n";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_THRESHOLD = 45;
const CALLOUT_BREAKPOINT = 760;

function calloutLines(
  slug: MuscleSlug,
  locale: ReturnType<typeof useI18n>["locale"],
  t: ReturnType<typeof useI18n>["t"],
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
) {
  const knowledge = localizeMuscleKnowledge(slug, locale, MUSCLE_KNOWLEDGE[slug]);
  const facts = readCalloutFacts(knowledge);
  const unavailable = t("Unavailable");
  return {
    name: t(MUSCLE_NAMES[slug]),
    role: facts.role ? t(facts.role) : unavailable,
    sessions: facts.sessions
      ? t("{min}–{max}×/week", {
          min: formatNumber(facts.sessions[0]),
          max: formatNumber(facts.sessions[1]),
        })
      : unavailable,
    sets: facts.sets
      ? t("{min}–{max} hard sets/week", {
          min: formatNumber(facts.sets[0]),
          max: formatNumber(facts.sets[1]),
        })
      : unavailable,
  };
}

export type MuscleExplorerProps = {
  data: MuscleHeatmapData;
  refreshing?: boolean;
  onRefresh?: () => void;
  initialMuscle?: MuscleSlug | null;
  /** Logger that should receive the plan. Absent means ask before using another open session. */
  workoutId?: string;
};

export function MuscleExplorer({
  data,
  refreshing,
  onRefresh,
  initialMuscle,
  workoutId,
}: MuscleExplorerProps) {
  const { t, locale, formatNumber } = useI18n();
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
  const [stageSize, setStageSize] = useState({
    w: SCREEN_WIDTH,
    h: 520,
  });
  const selectedRef = useRef<MuscleSlug | null>(null);
  const sideRef = useRef<BodySide>("front");
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spinHeld, setSpinHeld] = useState(false);
  const [spinPaused, setSpinPaused] = useState(false);

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

  const spinning = !reduceMotion && !spinPaused && !spinHeld && !selectedMuscle;

  useEffect(() => {
    sideRef.current = side;
  }, [side]);

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

  const changeSide = useCallback(
    (newSide: BodySide) => {
      if (newSide !== sideRef.current) {
        setSide(newSide);
        sideRef.current = newSide;
      }
      if (!reduceMotion) {
        setSpinHeld(true);
        if (holdTimer.current) clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(() => setSpinHeld(false), 5000);
      }
    },
    [reduceMotion],
  );

  // Load recommendations when muscle is selected
  const loadRecommendations = useCallback(async (muscle: MuscleSlug) => {
    setRecommendationsLoading(true);
    setRecommendationsError(null);

    try {
      const result = await api.muscleRecommendations(muscle);
      if (selectedRef.current !== muscle) return;
      setRecommendations(result);
      setActivation(activationFromRecommendations(muscle, result));
    } catch (err) {
      setRecommendationsError(
        err instanceof Error ? err.message : "Failed to load recommendations",
      );
    } finally {
      if (selectedRef.current === muscle) {
        setRecommendationsLoading(false);
      }
    }
  }, []);

  // Handle muscle selection — highlight the muscle plus combination partners immediately
  const handleMusclePress = useCallback(
    (muscle: MuscleSlug, pressedSide?: BodySide) => {
      setAiCircuit(null);

      if (selectedMuscle === muscle && (!pressedSide || pressedSide === side)) {
        selectedRef.current = null;
        setSelectedMuscle(null);
        setRecommendations(null);
        setActivation({});
        return;
      }

      selectedRef.current = muscle;
      setSelectedMuscle(muscle);
      setRecommendations(null);
      setActivation(combinationActivation(muscle));
      if (pressedSide && isVisibleOnSide(muscle, pressedSide)) {
        if (pressedSide !== side) changeSide(pressedSide);
      } else if (!isVisibleOnSide(muscle, side)) {
        changeSide(MUSCLE_HOME_SIDE[muscle]);
      }
      loadRecommendations(muscle);
    },
    [selectedMuscle, side, changeSide, loadRecommendations],
  );

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !initialMuscle) return;
    didInit.current = true;
    handleMusclePress(initialMuscle);
  }, [initialMuscle, handleMusclePress]);

  // Handle exercise selection -> activate that exercise's muscle set
  const handleExerciseSelect = useCallback(
    (exercise: RecommendationExercise) => {
      const newActivation: ActivationMap = {};

      if (
        exercise.primary_muscle_slug &&
        exercise.primary_muscle_slug !== "cardio"
      ) {
        newActivation[exercise.primary_muscle_slug] = "primary";
      }

      if (exercise.secondary_muscle_slugs) {
        for (const slug of exercise.secondary_muscle_slugs) {
          if (!newActivation[slug]) {
            newActivation[slug] = "secondary";
          }
        }
      }

      setActivation(newActivation);

      const primary =
        exercise.primary_muscle_slug &&
        exercise.primary_muscle_slug !== "cardio"
          ? exercise.primary_muscle_slug
          : null;
      if (primary && !isVisibleOnSide(primary, side)) {
        changeSide(MUSCLE_HOME_SIDE[primary]);
      }
    },
    [side, changeSide],
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

  // Add exercises (single or whole circuit) to the live session.
  // Reuses the open session if there is one, otherwise creates a new one.
  const [addToast, setAddToast] = useState<{
    workoutId: string;
    label: string;
    error?: boolean;
  } | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [mergeAsk, setMergeAsk] = useState<{ slugs: string[]; label: string; openId: string; openTitle: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showAdded = useCallback((targetId: string, label: string, created: boolean) => {
    setAddToast({
      workoutId: targetId,
      label: created
        ? t("{label} added to a new session", { label })
        : t("{label} added to this session", { label }),
    });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setAddToast(null), 6000);
  }, [t]);

  const createSession = useCallback(async (slugs: string[], label: string) => {
    const title = selectedMuscle ? `${t(MUSCLE_NAMES[selectedMuscle])} ${t("Session")}` : t("Session");
    const created = await api.createWorkout(title, undefined, slugs);
    showAdded(created.id, label, true);
  }, [selectedMuscle, showAdded, t]);

  const handleAddToWorkout = useCallback(
    async (slugs: string[], label: string) => {
      const unique = [...new Set(slugs)].filter(Boolean);
      if (!unique.length || addingKey) return;
      const key = unique.join("|");
      setAddingKey(key);
      try {
        if (workoutId) {
          await api.planExercises(workoutId, unique);
          showAdded(workoutId, label, false);
          return;
        }
        const existing = await api.workouts().catch(() => []);
        const open = existing.find((workout: { ended_at?: string | null; id: string; title?: string }) => !workout.ended_at);
        if (open) {
          setMergeAsk({ slugs: unique, label, openId: open.id, openTitle: open.title || t("Session") });
          return;
        }
        await createSession(unique, label);
      } catch (err) {
        setAddToast({
          workoutId: "",
          label: err instanceof Error ? err.message : t("Could not add to workout"),
          error: true,
        });
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setAddToast(null), 6000);
      } finally {
        setAddingKey(null);
      }
    },
    [addingKey, createSession, showAdded, t, workoutId],
  );

  const confirmExplorerMerge = async () => {
    if (!mergeAsk) return;
    const ask = mergeAsk;
    setMergeAsk(null);
    try {
      await api.planExercises(ask.openId, ask.slugs);
      showAdded(ask.openId, ask.label, false);
    } catch (err) {
      setAddToast({
        workoutId: "",
        label: err instanceof Error ? err.message : t("Could not add to workout"),
        error: true,
      });
    }
  };

  const declineExplorerMerge = async () => {
    if (!mergeAsk) return;
    const ask = mergeAsk;
    setMergeAsk(null);
    try {
      await createSession(ask.slugs, ask.label);
    } catch (err) {
      setAddToast({
        workoutId: "",
        label: err instanceof Error ? err.message : t("Could not add to workout"),
        error: true,
      });
    }
  };

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // Handle detail sheet close
  const handleCloseDetail = useCallback(() => {
    selectedRef.current = null;
    setSelectedMuscle(null);
    setRecommendations(null);
    setActivation({});
    setAiCircuit(null);
  }, []);

  const stats = selectedMuscle ? data.muscles?.[selectedMuscle] : undefined;
  const narrow = stageSize.w < CALLOUT_BREAKPOINT;
  const calloutPlans = React.useMemo(
    () => ({
      front: muscleCalloutPlans(FRONT_MUSCLES, FRONT_VIEWBOX),
      back: muscleCalloutPlans(BACK_MUSCLES, BACK_VIEWBOX),
    }),
    [],
  );
  const visibleSide: BodySide | null = selectedMuscle
    ? isVisibleOnSide(selectedMuscle, side)
      ? side
      : MUSCLE_HOME_SIDE[selectedMuscle]
    : null;
  const activePlan = visibleSide && selectedMuscle
    ? calloutPlans[visibleSide].find((plan) => plan.slug === selectedMuscle) ?? null
    : null;
  const sequence = useCalloutSequence(
    activePlan ? `${activePlan.side}:${activePlan.slug}` : null,
    reduceMotion,
  );
  const shownSide = sequence.shownKey?.split(":")[0] as BodySide | undefined;
  const shownSlug = sequence.shownKey?.split(":")[1] as MuscleSlug | undefined;
  const shownPlan = shownSide && shownSlug
    ? calloutPlans[shownSide]?.find((plan) => plan.slug === shownSlug) ?? null
    : null;
  const shownCopy = shownSlug ? calloutLines(shownSlug, locale, t, formatNumber) : null;
  const calloutLabel = shownCopy && shownPlan ? (
    <MuscleCalloutLabel
      name={shownCopy.name}
      role={shownCopy.role}
      sessions={shownCopy.sessions}
      sets={shownCopy.sets}
      sequence={sequence}
      compact={narrow}
      align={shownPlan.gutter === "right" ? "right" : "left"}
    />
  ) : null;
  const chromeH = narrow ? (selectedMuscle ? 148 : 84) : selectedMuscle ? 40 : 72;
  const zoom = selectedMuscle && !reduceMotion ? 1.05 : 1;
  const gap = 20;
  const maxH = Math.max(180, stageSize.h - chromeH - 36);
  const gutterW = !narrow && shownPlan ? 176 : 0;
  const maxCol = Math.max(90, (stageSize.w - 24 - gap - gutterW) / 2);
  let bodyW = Math.min(maxCol, narrow ? 180 : 250);
  let bodyH = bodyW * 2;
  if (bodyH > maxH) {
    bodyH = maxH;
    bodyW = bodyH / 2;
  }
  bodyW *= zoom;
  bodyH *= zoom;

  return (
    <View style={styles.container}>
      {/* Segmented control for side selection */}
      <View style={styles.controlBar}>
        <View style={styles.controlRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl
              options={[
                { value: "front", label: t("Front") },
                { value: "back", label: t("Back view") },
              ]}
              selected={side}
              onSelect={(value) => changeSide(value as BodySide)}
            />
          </View>
          {!reduceMotion ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={spinning ? t("Pause body rotation") : t("Spin body")}
              onPress={() => {
                setSpinPaused((paused) => !paused);
                setSpinHeld(false);
              }}
              style={styles.spinToggle}
            >
              <Text style={styles.spinToggleText}>
                {spinning ? t("Pause") : t("Spin")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {selectedMuscle ? (
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: colors.text }]}
              />
              <Text style={styles.legendLabel}>{t("Selected")}</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: colors.volt }]}
              />
              <Text style={styles.legendLabel}>{t("Combinations")}</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: colors.blaze }]}
              />
              <Text style={styles.legendLabel}>{t("Antagonist")}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Anatomy body */}
      <View
        style={styles.bodyContainer}
        {...(Platform.OS === "web" ? {} : panResponder.panHandlers)}
      >
        <LinearGradient
          colors={["#020617", "#0F172A", "#020617"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.bodyStage}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setStageSize((prev) =>
              prev.w === width && prev.h === height ? prev : { w: width, h: height },
            );
          }}
        >
          <View style={styles.stageRow}>
            <MuscleHeatmap
              volumes={data.volumes}
              max={data.max}
              selectedMuscle={selectedMuscle}
              activation={activation}
              spinning={spinning}
              reduceMotion={reduceMotion}
              emphasize={side}
              bodyWidth={bodyW}
              bodyHeight={bodyH}
              showLegend={false}
              showStatus={false}
              onMusclePress={handleMusclePress}
              callout={
                shownPlan && shownCopy
                  ? {
                      side: shownPlan.side,
                      gutter: shownPlan.gutter,
                      leader: shownPlan.leader,
                      line: sequence.line,
                      placement: narrow ? "below" : "beside",
                      label: narrow ? null : calloutLabel,
                    }
                  : null
              }
            />
          </View>
          {!selectedMuscle ? (
            <Text style={styles.idleLabel}>
              {t("Front and Back stay on screen — tap a muscle on either body")}
            </Text>
          ) : null}
          {narrow ? calloutLabel : null}
        </LinearGradient>
      </View>

      {/* Both bodies are always on screen, so no "flip to see partners" overlay:
          an absolutely-positioned pill here used to sit on top of the bodies and
          swallow taps meant for the muscles. */}

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
            onPartnerPress={handleMusclePress}
            onRetryRecommendations={() => loadRecommendations(selectedMuscle)}
            onRegenerate={handleRegenerate}
            onClose={handleCloseDetail}
            onAddToWorkout={handleAddToWorkout}
            addingKey={addingKey}
          />
        </View>
      )}

      <Modal visible={!!mergeAsk} transparent animationType="fade" onRequestClose={() => setMergeAsk(null)}>
        <Pressable style={styles.mergeBackdrop} onPress={() => setMergeAsk(null)}>
          <Pressable style={styles.mergeSheet} testID="explorer-merge-sheet" onPress={(event) => event.stopPropagation()}>
            <Text style={styles.toastText}>{t("Add these exercises to {title}?", { title: mergeAsk?.openTitle ?? "" })}</Text>
            <Pressable accessibilityRole="button" testID="explorer-merge-open" onPress={() => void confirmExplorerMerge()} style={styles.toastBtn}>
              <Text style={styles.toastBtnText}>{t("ADD TO OPEN SESSION")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" testID="explorer-merge-new" onPress={() => void declineExplorerMerge()} style={styles.toastBtn}>
              <Text style={styles.toastBtnText}>{t("NEW SESSION")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {addToast ? (
        <View
          style={[styles.toast, addToast.error && styles.toastError]}
          accessibilityLiveRegion="polite"
          testID="add-to-workout-toast"
        >
          <Text style={styles.toastText} numberOfLines={2}>
            {addToast.label}
          </Text>
          {!addToast.error ? (
            <Pressable
              onPress={() => {
                setAddToast(null);
                router.push(`/workout/${addToast.workoutId}`);
              }}
              accessibilityRole="button"
              accessibilityLabel={t("Open live session")}
              style={styles.toastBtn}
            >
              <Text style={styles.toastBtnText}>{t("OPEN")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface2,
    borderColor: colors.text,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },
  toastError: { borderColor: colors.error },
  toastText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "600" },
  toastBtn: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  toastBtnText: { color: colors.brandOn, fontWeight: "800", letterSpacing: 1 },
  mergeBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: spacing.xl },
  mergeSheet: { backgroundColor: colors.surface2, borderRadius: 12, padding: spacing.lg, gap: spacing.md },
  controlBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  spinToggle: {
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  spinToggleText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 12,
    color: colors.text,
    fontWeight: "600",
  },
  bodyContainer: {
    flex: 1,
  },
  bodyStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    width: "100%",
    overflow: "visible",
  },
  stageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  idleLabel: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.md,
    color: colors.volt,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  detailSheet: {
    height: "42%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderTopWidth: 1,
    borderTopColor: colors.text,
  },
});
