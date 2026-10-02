import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
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
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import * as Haptics from "expo-haptics";
import { api, type Community } from "@/src/api";
import { track } from "@/src/analytics";
import { enqueueSet, flushQueue, onQueueChange, pendingFor } from "@/src/offline-queue";
import { cancelRestEndNotification, scheduleRestEndNotification } from "@/src/rest-timer";
import { useFieldAffordance, usePressFeedback } from "@/src/press-feedback";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

/** Club is `community_id`. `public` and `friends` are the only audience values sent. */
type ShareAudience =
  | { kind: "club"; id: string }
  | { kind: "friends" }
  | { kind: "public" };

function shareBody(workoutId: string, audience: ShareAudience) {
  switch (audience.kind) {
    case "club":
      return { content: "", workout_id: workoutId, community_id: audience.id };
    case "friends":
      return { content: "", workout_id: workoutId, audience: "friends" as const };
    case "public":
      return { content: "", workout_id: workoutId, audience: "public" as const };
    default: {
      const unreachable: never = audience;
      return unreachable;
    }
  }
}

const DEFAULT_REST_SEC = 90;

function isOptimisticSet(row: { id?: string }): boolean {
  return typeof row.id === "string" && row.id.startsWith("local-");
}

/** Keep rows the server has not confirmed yet. A failed list must not wipe them. */
function mergeServerSets(server: any[], local: any[]): any[] {
  const pending = local.filter(
    (row) =>
      isOptimisticSet(row) &&
      !server.some((saved) => saved.exercise_id === row.exercise_id && saved.set_index === row.set_index),
  );
  return [...server, ...pending];
}

export default function WorkoutLogger() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, formatNumber } = useI18n();
  const press = usePressFeedback();
  const pickerSearch = useFieldAffordance();
  const [sets, setSets] = useState<any[]>([]);
  const [exercises, setExercises] = useState<any[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerMuscle, setPickerMuscle] = useState<string | null>(null);
  const [muscles, setMuscles] = useState<any[]>([]);
  const [selectedEx, setSelectedEx] = useState<any | null>(null);
  const [reps, setReps] = useState("8");
  const [lastTime, setLastTime] = useState<{ weight_kg: number; reps: number } | null>(null);
  const [weight, setWeight] = useState("60");
  const [rpe, setRpe] = useState("7");
  const [queued, setQueued] = useState(0);
  const [loggerError, setLoggerError] = useState("");
  const [finishError, setFinishError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState<{ sets: number; minutes: number; tonnage: number } | null>(null);

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
  const selectedExRef = useRef<any>(null);
  const setsRef = useRef<any[]>([]);
  const plannedRef = useRef<any[]>([]);
  const exercisesRef = useRef<any[]>([]);
  const sourceExercisesRef = useRef<any[]>([]);
  const priorSetsRef = useRef<any[]>([]);
  setsRef.current = sets;
  plannedRef.current = planned;
  exercisesRef.current = exercises;

  const load = useCallback(async () => {
    if (!id) return;
    const notes: string[] = [];
    try {
      await flushQueue();
      if ((await pendingFor(id)) > 0) notes.push(t("Could not sync your sets. They are still here."));
    } catch {
      notes.push(t("Could not sync your sets. They are still here."));
    }
    const [setsResult, exercisesResult, musclesResult, workoutResult] = await Promise.allSettled([
      api.listSets(id),
      api.exercises(),
      api.muscles(),
      api.workout(id),
    ]);
    let visibleSets = setsRef.current;
    if (setsResult.status === "fulfilled") {
      visibleSets = mergeServerSets(setsResult.value ?? [], setsRef.current);
      setSets(visibleSets);
    } else {
      notes.push(t("Could not refresh sets. Showing what you already logged."));
    }
    if (exercisesResult.status === "fulfilled") setExercises(exercisesResult.value ?? []);
    if (musclesResult.status === "fulfilled") setMuscles(musclesResult.value ?? []);
    let plan = plannedRef.current;
    if (workoutResult.status === "fulfilled") {
      plan = workoutResult.value?.planned_exercises ?? [];
      setPlanned(plan);
      setWorkoutTitle(workoutResult.value?.title ?? null);
      sourceExercisesRef.current = workoutResult.value?.source?.exercises ?? [];
    } else {
      notes.push(t("Could not refresh this session. Your plan is unchanged."));
    }
    setLoggerError(notes[0] ?? "");
    // Prefer the first planned exercise that has no sets yet, then any planned, then the catalog.
    if (!selectedExRef.current) {
      const catalog = exercisesResult.status === "fulfilled" ? exercisesResult.value ?? [] : exercisesRef.current;
      const logged = new Set(visibleSets.map((row: any) => row.exercise_id));
      const next = plan.find((item) => !logged.has(item.id)) ?? plan[0] ?? catalog[0];
      if (next) {
        selectedExRef.current = next;
        setSelectedEx(next);
      }
    }
  }, [id, t]);

  // Reload on mount and whenever the screen regains focus (e.g. back from the
  // Muscle Explorer after queueing more exercises into this session).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Rest timer countdown. The OS alert is scheduled separately so locking the phone still cues the next set.
  useEffect(() => {
    if (restRemaining <= 0) return;
    restRef.current = setTimeout(() => setRestRemaining((v) => v - 1), 1000);
    return () => clearTimeout(restRef.current);
  }, [restRemaining]);

  useEffect(() => {
    return () => {
      void cancelRestEndNotification();
    };
  }, []);

  const startRest = (seconds: number) => {
    setRestRemaining(seconds);
    void scheduleRestEndNotification({
      seconds,
      title: t("Rest complete"),
      body: t("Time for the next set."),
      channelName: t("Rest timer"),
    });
  };

  const stopRest = () => {
    setRestRemaining(0);
    void cancelRestEndNotification();
  };

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

  // Prefill from the last finished session. rest_sec on that log is the length
  // the timer uses; when it is absent the program day, then 90s, is the fallback.
  useEffect(() => {
    const exerciseId = selectedEx?.id;
    if (!exerciseId) {
      setLastTime(null);
      return;
    }
    let cancelled = false;
    setLastTime(null);
    api.previousSets(exerciseId, 1).then((payload) => {
      if (cancelled) return;
      const prior = (payload.sessions?.[0]?.sets ?? []) as any[];
      priorSetsRef.current = prior;
      const summary = prior.find((row) => row.set_index === 1) ?? prior[0];
      if (summary?.reps != null && summary?.weight_kg != null) {
        setLastTime({ weight_kg: Number(summary.weight_kg), reps: Number(summary.reps) });
      }
      const match = prior.find((row) => row.set_index === nextSetIndex) ?? prior[0];
      if (!match) return;
      if (match.reps != null) setReps(String(match.reps));
      if (match.weight_kg != null) setWeight(String(match.weight_kg));
      if (match.rpe != null) setRpe(String(match.rpe));
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [nextSetIndex, selectedEx?.id]);

  const restLengthFor = (exercise: any, setIndexJustLogged: number): number => {
    const prior = priorSetsRef.current;
    const upcoming = prior.find((row) => row.set_index === setIndexJustLogged + 1);
    if (typeof upcoming?.rest_sec === "number") return upcoming.rest_sec;
    const same = prior.find((row) => row.set_index === setIndexJustLogged);
    if (typeof same?.rest_sec === "number") return same.rest_sec;
    const prescribed = sourceExercisesRef.current.find((row) => row.exercise_slug === exercise?.slug);
    if (typeof prescribed?.rest_sec === "number") return prescribed.rest_sec;
    return DEFAULT_REST_SEC;
  };

  const quickAddSet = async () => {
    if (!selectedEx || !id) return;
    const r = parseInt(reps, 10);
    const w = parseFloat(weight);
    const rp = parseFloat(rpe);
    if (!r || Number.isNaN(w)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const historical = priorSetsRef.current.find((row) => row.set_index === nextSetIndex);
    const restBefore = typeof historical?.rest_sec === "number" ? historical.rest_sec : null;
    // Optimistic local update — sub-3-second UX guarantee
    const optimistic = {
      id: `local-${Date.now()}`,
      workout_id: id,
      exercise_id: selectedEx.id,
      set_index: nextSetIndex,
      reps: r,
      weight_kg: w,
      rpe: Number.isNaN(rp) ? null : rp,
      rest_sec: restBefore,
    };
    setSets((prev) => {
      const next = [...prev, optimistic];
      setsRef.current = next;
      return next;
    });
    await enqueueSet(id, {
      exercise_id: selectedEx.id,
      set_index: nextSetIndex,
      reps: r,
      weight_kg: w,
      rpe: Number.isNaN(rp) ? null : rp,
      rest_sec: restBefore,
    });
    startRest(restLengthFor(selectedEx, nextSetIndex));
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
  const [clubs, setClubs] = useState<Pick<Community, "id" | "name">[] | null>(null);
  const [clubsError, setClubsError] = useState("");
  const [audience, setAudience] = useState<ShareAudience>({ kind: "friends" });
  const [audienceReady, setAudienceReady] = useState(false);
  const audienceChosen = useRef(false);
  const clubsRequested = useRef(false);
  const finish = async () => {
    if (!id || finishing || finished) return;
    stopRest();
    setFinishing(true);
    setFinishError("");
    try {
      // The share card snapshots the sets the server holds. A queued set that
      // did not land keeps the athlete in the logger — the complete panel stays shut.
      await flushQueue();
      if ((await pendingFor(id)) > 0) {
        setFinishError(t("Could not sync sets. Finish stays closed until they land."));
        setLoggerError(t("Could not sync your sets. They are still here."));
        return;
      }
      const result = await api.finishWorkout(id);
      if (!result?.ended_at) {
        setFinishError(t("Session did not finish. Try again."));
        return;
      }
      const logged = setsRef.current;
      const tonnage = logged.reduce(
        (sum, row) => sum + (Number(row.weight_kg) || 0) * (Number(row.reps) || 0),
        0,
      );
      setSummary({
        sets: logged.length,
        minutes: Math.max(0, Math.round(Number(result.duration_sec) || 0) / 60),
        tonnage,
      });
      setFinished(true);
    } catch (cause) {
      setFinishError(cause instanceof Error ? cause.message : t("Could not finish session"));
    } finally {
      setFinishing(false);
    }
  };
  const loadClubs = useCallback(async () => {
    setClubsError("");
    try {
      const rows = await api.communities("mine");
      const active = rows.filter(row => row.membership?.status === "active");
      setClubs(active.map(row => ({ id: row.id, name: row.name })));
      // Default is the athlete's club when they have one. Otherwise friends.
      // Public is an explicit choice and is never the fallback.
      if (!audienceChosen.current) {
        setAudience(active[0] ? { kind: "club", id: active[0].id } : { kind: "friends" });
      }
    } catch (cause) {
      setClubs([]);
      if (!audienceChosen.current) setAudience({ kind: "friends" });
      setClubsError(cause instanceof Error ? cause.message : t("Could not load your clubs."));
    } finally {
      setAudienceReady(true);
    }
  }, [t]);
  useEffect(() => {
    if (!finished || clubsRequested.current) return;
    clubsRequested.current = true;
    void loadClubs();
  }, [finished, loadClubs]);
  const pickAudience = (next: ShareAudience) => {
    audienceChosen.current = true;
    setAudience(next);
  };
  const share = async () => {
    if (!id || sharing || !audienceReady) return;
    setSharing(true); setShareError("");
    try {
      const workout = await api.workout(id);
      // A finish that did not stick must not publish or leave the logger.
      if (!workout?.ended_at) {
        setShareError(t("Finish the workout before sharing it"));
        return;
      }
      const post = await api.publish(shareBody(id, audience));
      track("post_created", {
        post_id: post.id,
        has_media: false,
        has_poll: false,
        ...(audience.kind === "club" ? { community_id: audience.id } : {}),
      });
      router.replace("/community");
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { setSharing(false); }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="workout-logger">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="back-btn" hitSlop={12} style={press("ghost", styles.iconBtn)}>
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
        <Pressable onPress={finish} testID="finish-btn" hitSlop={12} disabled={finishing || finished} style={press("ghost", styles.finishBtn, { disabled: finishing || finished })}>
          <Text style={styles.finishTxt}>{finishing ? t("FINISHING…") : t("FINISH")}</Text>
        </Pressable>
      </View>

      {(loggerError || finishError) ? (
        <View style={styles.errorBanner} accessibilityRole="alert" testID={finishError ? "finish-error" : "logger-error"}>
          <Ionicons name="alert-circle" color={colors.live} size={16} />
          <Text style={styles.errorTxt}>{finishError || loggerError}</Text>
        </View>
      ) : null}

      <View style={styles.planWrap} testID="planned-queue">
        <Text style={styles.planLabel}>
          {planned.length > 0
            ? t("PLANNED · {count}", { count: formatNumber(planned.length) })
            : t("NO PLAN YET")}
        </Text>
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
                  onPress={() => {
                    selectedExRef.current = p;
                    setSelectedEx(p);
                  }}
                  style={press("chip", [styles.planChip, active && styles.planChipActive, done > 0 && styles.planChipDone], { preserveBorder: active || done > 0 })}
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
              onPress={() => router.push(`/muscles?workoutId=${id}` as Href)}
              style={press("surface", [styles.planChip, styles.planChipAdd])}
              accessibilityRole="button"
              accessibilityLabel={t("Add exercises from the muscle explorer")}
              testID="add-from-muscles"
            >
              <Ionicons name="add" size={16} color={colors.text} />
              <Text style={[styles.planName, { color: colors.text }]}>{t("Add from muscles")}</Text>
            </Pressable>
          </ScrollView>
        </View>

      {restRemaining > 0 && (
        <View style={styles.timer} testID="rest-timer">
          <Text style={styles.timerLabel}>{t("Rest")}</Text>
          <Text style={styles.timerVal}>{restRemaining}s</Text>
          <Pressable onPress={stopRest} testID="skip-timer-btn" accessibilityRole="button" accessibilityLabel={t("Rest")} style={press("ghost", styles.skipBtn)}>
            <Ionicons name="close" color={colors.textDim} size={18} />
          </Pressable>
        </View>
      )}

      {queued > 0 && (
        <View style={styles.warningBanner} testID="offline-banner">
          <Ionicons name="cloud-offline" color={colors.warning} size={16} />
          <Text style={styles.warningTxt}>{t(queued === 1 ? "{count} set pending sync" : "{count} sets pending sync", { count: formatNumber(queued) })}</Text>
        </View>
      )}

      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }}>
          <Pressable
            testID="pick-exercise-btn"
            style={press("surface", styles.exSelector)}
            onPress={() => setPickerOpen(true)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.exSelectorLabel}>{t("EXERCISE")}</Text>
              <Text style={styles.exSelectorName}>
                {selectedEx?.name ?? t("Pick an exercise")}
              </Text>
              {lastTime ? (
                <Text style={styles.lastTime}>
                  {t("Last time: {kg} × {reps}", { kg: formatNumber(lastTime.weight_kg), reps: formatNumber(lastTime.reps) })}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-down" color={colors.text} size={22} />
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
              style={press("ghost", styles.progLink)}
              onPress={() => router.push(`/progression/${selectedEx.id}`)}
            >
              <Ionicons name="trending-up" color={colors.text} size={16} />
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
            style={press("primary", styles.addBtn)}
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
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={12} style={press("ghost", styles.iconBtn)} testID="picker-close">
                <Ionicons name="close" color={colors.text} size={22} />
              </Pressable>
            </View>
            <TextInput
              placeholder={t("Search…")}
              placeholderTextColor={colors.textDim}
              style={[styles.pickerSearch, pickerSearch.style]}
              value={pickerQuery}
              onChangeText={setPickerQuery}
              testID="picker-search"
              {...pickerSearch.hover}
              {...pickerSearch.focus}
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
                  style={press("surface", styles.pickerItem)}
                  onPress={() => {
                    selectedExRef.current = item;
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
      {finished && summary ? <View style={styles.sharePanel} testID="share-panel">
        <Text style={styles.shareTitle}>{t("SESSION COMPLETE")}</Text>
        <Text style={styles.shareCopy} testID="session-summary">
          {t("{count} sets", { count: formatNumber(summary.sets) })}
          {" · "}
          {t("{count} min", { count: formatNumber(summary.minutes) })}
          {" · "}
          {formatNumber(Math.round(summary.tonnage))} kg
        </Text>
        <Text style={styles.shareCopy}>{t("Share it with the people you train with?")}</Text>
        <Text style={styles.shareAudienceLabel}>{t("Choose audience")}</Text>
        {!audienceReady ? <ActivityIndicator color={colors.text} /> : <View style={styles.shareChips} testID="share-audience">
          {(clubs ?? []).map(club => {
            const selected = audience.kind === "club" && audience.id === club.id;
            return <Pressable key={club.id} accessibilityRole="button" accessibilityState={{ selected }} testID={`share-audience-club-${club.id}`} onPress={() => pickAudience({ kind: "club", id: club.id })} style={press("chip", [styles.shareChip, selected && styles.shareChipOn], { preserveBorder: selected })}>
              <Text style={[styles.shareChipText, selected && styles.shareChipTextOn]}>{club.name}</Text>
            </Pressable>;
          })}
          <Pressable accessibilityRole="button" accessibilityState={{ selected: audience.kind === "friends" }} testID="share-audience-friends" onPress={() => pickAudience({ kind: "friends" })} style={press("chip", [styles.shareChip, audience.kind === "friends" && styles.shareChipOn], { preserveBorder: audience.kind === "friends" })}>
            <Text style={[styles.shareChipText, audience.kind === "friends" && styles.shareChipTextOn]}>{t("Friends")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: audience.kind === "public" }} testID="share-audience-public" onPress={() => pickAudience({ kind: "public" })} style={press("chip", [styles.shareChip, audience.kind === "public" && styles.shareChipOn], { preserveBorder: audience.kind === "public" })}>
            <Text style={[styles.shareChipText, audience.kind === "public" && styles.shareChipTextOn]}>{t("Public")}</Text>
          </Pressable>
        </View>}
        {clubsError ? <View accessibilityRole="alert" testID="share-clubs-error">
          <Text style={styles.shareError}>{clubsError}</Text>
          <Pressable accessibilityRole="button" testID="share-clubs-retry" onPress={() => void loadClubs()} style={press("ghost", styles.shareRetryBtn)}><Text style={styles.shareRetry}>{t("Retry")}</Text></Pressable>
        </View> : null}
        {shareError ? <Text accessibilityRole="alert" testID="share-error" style={styles.shareError}>{shareError}</Text> : null}
        <View style={styles.shareRow}>
          <Pressable accessibilityRole="button" testID="share-done" onPress={() => router.back()} style={press("outline", styles.shareSecondary)}><Text style={styles.shareSecondaryText}>{t("DONE")}</Text></Pressable>
          <Pressable accessibilityRole="button" testID="share-workout" disabled={sharing || !audienceReady} onPress={() => void share()} style={press("primary", [styles.sharePrimary, (sharing || !audienceReady) && { opacity: 0.5 }], { disabled: sharing || !audienceReady })}><Text style={styles.sharePrimaryText}>{t("SHARE TO FEED")}</Text></Pressable>
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
  const field = useFieldAffordance();
  return (
    <View style={styles.col}>
      <Text style={styles.colLabel}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        style={[styles.colInput, field.style]}
        selectTextOnFocus
        {...field.hover}
        {...field.focus}
      />
    </View>
  );
}

function PickerChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const press = usePressFeedback();
  return (
    <Pressable
      onPress={onPress}
      style={press("chip", [styles.pchip, active && styles.pchipActive], { preserveBorder: active })}
    >
      <Text style={[styles.pchipTxt, active && styles.pchipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sharePanel: { position: "absolute", left: 16, right: 16, bottom: 32, padding: 20, borderRadius: 12, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.text, gap: 8 },
  shareTitle: { color: colors.text, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  shareCopy: { color: colors.text, fontSize: 15 },
  shareError: { color: colors.error, fontSize: 12 },
  shareRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  shareSecondary: { flex: 1, minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  shareSecondaryText: { color: colors.text, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  sharePrimary: { flex: 1.4, minHeight: 48, borderRadius: 8, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  sharePrimaryText: { color: colors.brandOn, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  shareAudienceLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  shareChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  shareChip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  shareChipOn: { borderColor: colors.text, backgroundColor: colors.surface2 },
  shareChipText: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  shareChipTextOn: { color: colors.text },
  shareRetry: { color: colors.text, fontWeight: "800", fontSize: 12 },
  shareRetryBtn: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: radius.sm },
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
  planChipActive: { borderColor: colors.text, backgroundColor: colors.surface2 },
  planChipDone: { borderColor: colors.success },
  planChipAdd: { borderStyle: "dashed", borderColor: colors.text, backgroundColor: "transparent" },
  planIdx: { color: colors.textDim, fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  planName: { color: colors.text, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  planTxtActive: { color: colors.text },
  finishTxt: {
    color: colors.text,
    fontWeight: "800",
    letterSpacing: 1.2,
    minHeight: 44,
    textAlignVertical: "center",
    paddingHorizontal: spacing.sm,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.errorWash,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warningWash,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  warningTxt: { color: colors.text, fontSize: 13, fontWeight: "400", flex: 1 },
  errorTxt: { color: colors.text, fontSize: 13, fontWeight: "400", flex: 1 },
  timer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  timerLabel: { color: colors.textDim, fontWeight: "400", fontSize: 13 },
  timerVal: {
    color: colors.text,
    fontWeight: "700",
    flex: 1,
    fontSize: 20,
    fontVariant: ["tabular-nums"],
  },
  exSelector: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  exSelectorLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: "800" },
  exSelectorName: { color: colors.text, fontSize: 17, fontWeight: "600", marginTop: 4 },
  lastTime: { color: colors.textDim, fontSize: 13, fontWeight: "400", marginTop: 4 },
  setsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
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
    alignSelf: "flex-start",
    borderRadius: radius.sm,
  },
  progLinkTxt: { color: colors.text, fontWeight: "700" },
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
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  skipBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  finishBtn: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.sm,
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
  pchipActive: { borderColor: colors.text, backgroundColor: colors.surface2 },
  pchipTxt: { color: colors.textMuted, fontWeight: "700", fontSize: 11 },
  pchipTxtActive: { color: colors.text },
  pickerItem: {
    padding: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerItemName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  pickerItemMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
