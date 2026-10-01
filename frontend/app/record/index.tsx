import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { api } from "@/src/api";
import { RouteSketch } from "@/src/components/route-sketch";
import { holdAwake, requestLocation, watchBarometer, watchLocation, watchSteps } from "@/src/recorder-device";
import {
  appendElevation,
  appendFix,
  emptyElevation,
  emptyTrack,
  formatClock,
  formatPace,
  newClientId,
  paceSecPerKm,
  rebaseElevation,
  recordingBody,
  routeSketch,
  SPORTS,
  speedKmh,
  sportProfile,
  sportTitle,
  type ElevationTrack,
  type RecordingBody,
  type Sport,
  type Track,
} from "@/src/recorder-math";
import { useI18n } from "@/src/i18n";
import { storage } from "@/src/utils/storage";
import { pressableStyle, useReducedMotion } from "@/src/affordance";
import { colors, radius, spacing } from "@/src/theme";

const PENDING_KEY = "ironflow_pending_recording";

type Phase = "idle" | "recording" | "paused";
type LocationState = "idle" | "waiting" | "watching" | "off";

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default function RecordScreen() {
  const { t, formatNumber } = useI18n();
  const reduceMotion = useReducedMotion();
  const [kind, setKind] = useState<Sport>("walk");
  const [phase, setPhase] = useState<Phase>("idle");
  const [movingMs, setMovingMs] = useState(0);
  const [track, setTrack] = useState<Track>(emptyTrack());
  const [steps, setSteps] = useState<number | null>(null);
  const [elevation, setElevation] = useState<ElevationTrack>(emptyElevation());
  const [location, setLocation] = useState<LocationState>("idle");
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<RecordingBody | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const kindRef = useRef<Sport>("walk");
  const trackRef = useRef<Track>(emptyTrack());
  const startedAtRef = useRef<number | null>(null);
  const stretchStartRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  const clientIdRef = useRef(newClientId());
  const breakRef = useRef(false);
  const stepsAccumRef = useRef(0);
  const stepsLiveRef = useRef(0);
  const elevationRef = useRef<ElevationTrack>(emptyElevation());
  const stopGpsRef = useRef<(() => void) | null>(null);
  const stopStepsRef = useRef<(() => void) | null>(null);
  const stopBarometerRef = useRef<(() => void) | null>(null);
  const releaseAwakeRef = useRef<(() => void) | null>(null);
  const pauseRef = useRef<() => void>(() => undefined);
  const sensorGen = useRef(0);

  useEffect(() => {
    void storage.getItem(PENDING_KEY, null).then((value) => {
      if (value && typeof value === "object") setPending(value as unknown as RecordingBody);
    });
  }, []);

  useEffect(() => {
    if (phase !== "recording") return undefined;
    const id = setInterval(() => {
      const start = stretchStartRef.current;
      if (start === null) return;
      setMovingMs(accumulatedRef.current + (Date.now() - start));
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") pauseRef.current();
    });
    return () => {
      sub.remove();
      releaseSensors();
    };
  }, []);

  const publishSteps = () => {
    const total = stepsAccumRef.current + stepsLiveRef.current;
    setSteps(total > 0 ? total : null);
  };

  function releaseSensors() {
    stopGpsRef.current?.();
    stopGpsRef.current = null;
    stopStepsRef.current?.();
    stopStepsRef.current = null;
    stopBarometerRef.current?.();
    stopBarometerRef.current = null;
    releaseAwakeRef.current?.();
    releaseAwakeRef.current = null;
  }

  const stopWatch = () => {
    stopGpsRef.current?.();
    stopGpsRef.current = null;
  };

  const beginSensors = async (generation: number) => {
    const profile = sportProfile(kindRef.current);
    const permission = await requestLocation();
    if (generation !== sensorGen.current) return;
    setCanAskAgain(permission.canAskAgain);
    if (!permission.granted) {
      setLocation("off");
    } else {
      setLocation("waiting");
      try {
        const watch = await watchLocation(profile.gps, (fix) => {
          if (generation !== sensorGen.current || phaseRef.current !== "recording") return;
          const started = startedAtRef.current;
          if (started === null || fix.t < started - 2000) return;
          const next = appendFix(trackRef.current, fix, kindRef.current, breakRef.current);
          breakRef.current = false;
          trackRef.current = next;
          setTrack(next);
          setLocation("watching");
        });
        if (generation !== sensorGen.current || phaseRef.current !== "recording") {
          watch.stop();
        } else {
          stopWatch();
          stopGpsRef.current = watch.stop;
        }
      } catch {
        if (generation === sensorGen.current) setLocation("off");
      }
    }
    if (generation !== sensorGen.current) return;

    if (!stopStepsRef.current) {
      const stepsWatch = await watchSteps((count) => {
        if (generation !== sensorGen.current || phaseRef.current !== "recording") return;
        stepsLiveRef.current = count;
        publishSteps();
      });
      if (generation !== sensorGen.current) {
        stepsWatch?.stop();
      } else if (stepsWatch) {
        stopStepsRef.current = stepsWatch.stop;
      }
    }

    if (!stopBarometerRef.current) {
      const barometer = await watchBarometer((altitude) => {
        if (generation !== sensorGen.current || phaseRef.current !== "recording") return;
        setElevation((current) => {
          const next = appendElevation(current, altitude);
          elevationRef.current = next;
          return next;
        });
      });
      if (generation !== sensorGen.current) {
        barometer?.stop();
      } else if (barometer) {
        stopBarometerRef.current = barometer.stop;
      }
    }

    if (!releaseAwakeRef.current && generation === sensorGen.current) {
      releaseAwakeRef.current = await holdAwake();
    }
  };

  const start = () => {
    if (phaseRef.current === "recording" || saving) return;
    setError(null);
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    breakRef.current = phaseRef.current === "paused";
    accumulatedRef.current = phaseRef.current === "paused" ? accumulatedRef.current : 0;
    if (phaseRef.current !== "paused") {
      trackRef.current = emptyTrack();
      setTrack(emptyTrack());
      stepsAccumRef.current = 0;
      stepsLiveRef.current = 0;
      setSteps(null);
      elevationRef.current = emptyElevation();
      setElevation(emptyElevation());
    }
    stretchStartRef.current = Date.now();
    phaseRef.current = "recording";
    setPhase("recording");
    sensorGen.current += 1;
    void beginSensors(sensorGen.current);
  };

  const pause = () => {
    if (phaseRef.current !== "recording") return;
    sensorGen.current += 1;
    const startAt = stretchStartRef.current;
    if (startAt !== null) accumulatedRef.current += Date.now() - startAt;
    stretchStartRef.current = null;
    setMovingMs(accumulatedRef.current);
    phaseRef.current = "paused";
    setPhase("paused");
    stopWatch();
    stepsAccumRef.current += stepsLiveRef.current;
    stepsLiveRef.current = 0;
    stopStepsRef.current?.();
    stopStepsRef.current = null;
    publishSteps();
    elevationRef.current = rebaseElevation(elevationRef.current);
    setElevation(elevationRef.current);
    stopBarometerRef.current?.();
    stopBarometerRef.current = null;
  };
  pauseRef.current = pause;

  const movingSecNow = () => {
    const extra = phaseRef.current === "recording" && stretchStartRef.current !== null
      ? Date.now() - stretchStartRef.current
      : 0;
    return Math.round((accumulatedRef.current + extra) / 1000);
  };

  const saveBody = async (body: RecordingBody) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.recordWorkout(body);
      if (!saved || typeof saved.id !== "string") throw new Error(t("Could not save this recording"));
      await storage.removeItem(PENDING_KEY);
      setPending(null);
      router.replace(`/record/${saved.id}` as Href);
    } catch (cause) {
      await storage.setItem(PENDING_KEY, body as never);
      setPending(body);
      setError(messageOf(cause, t("Could not save this recording")));
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    if (saving) return;
    const movingSec = movingSecNow();
    if (movingSec < 1 || startedAtRef.current === null) return;
    if (phaseRef.current === "recording") pause();
    releaseAwakeRef.current?.();
    releaseAwakeRef.current = null;
    const endedAt = Date.now();
    const stepTotal = stepsAccumRef.current;
    const gained = elevationRef.current;
    const body = recordingBody({
      clientId: clientIdRef.current,
      kind: kindRef.current,
      startedAt: startedAtRef.current,
      endedAt,
      movingSec: Math.min(movingSec, Math.max(1, Math.round((endedAt - startedAtRef.current) / 1000))),
      steps: stepTotal > 0 ? stepTotal : null,
      elevationGainM: gained.seen ? gained.gain : null,
      track: trackRef.current,
    });
    void saveBody(body);
  };

  const profile = sportProfile(kind);
  const movingSec = Math.floor(movingMs / 1000);
  const canFinish = movingSec >= 1 && !saving;
  const pace = profile.display === "pace" ? paceSecPerKm(track.distanceM, movingSec) : null;
  const speed = profile.display === "speed" ? speedKmh(track.distanceM, movingSec) : null;
  const hasLine = routeSketch(track.segments).length > 0;

  const distanceText = track.distanceM === null
    ? t("Not measured")
    : track.distanceM >= 1000
      ? t("{count} km", { count: formatNumber(track.distanceM / 1000, { maximumFractionDigits: 2 }) })
      : t("{count} m", { count: formatNumber(Math.round(track.distanceM)) });

  const distanceNote = track.distanceM !== null
    ? null
    : location === "off"
      ? t("Location off")
      : phase !== "idle"
        ? t("Waiting for GPS")
        : null;

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="record-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Back")}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
            hitSlop={12}
            style={(state) => [styles.back, pressableStyle(state, { variant: "quiet", reduceMotion })]}
            testID="record-back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.kicker}>{t("RECORD")}</Text>
        </View>

        {pending && phase === "idle" ? (
          <View style={styles.banner} testID="record-pending">
            <Text style={styles.bannerTxt}>{t("A recording is still on this phone")}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void saveBody(pending)}
              disabled={saving}
              style={(state) => [styles.bannerBtn, pressableStyle(state, { variant: "surface", reduceMotion, disabled: saving })]}
              testID="record-pending-retry"
            >
              <Text style={styles.bannerBtnTxt}>{saving ? t("SAVING...") : t("Try again")}</Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {SPORTS.map((sport) => {
            const selected = sport === kind;
            const locked = phase !== "idle" || saving;
            return (
              <Pressable
                key={sport}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={locked}
                onPress={() => {
                  kindRef.current = sport;
                  setKind(sport);
                }}
                style={(state) => [
                  styles.chip,
                  selected && styles.chipOn,
                  pressableStyle(state, {
                    variant: selected ? "mark" : "surface",
                    reduceMotion,
                    disabled: locked,
                  }),
                ]}
                testID={`sport-${sport}`}
              >
                <Text style={[styles.chipTxt, selected && styles.chipTxtOn]}>{t(sportTitle(sport))}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {kind === "hike" ? <Text style={styles.note} testID="record-gps-note">{t("Coarser GPS")}</Text> : null}

        <Text style={styles.clock} testID="record-clock">{formatClock(movingMs)}</Text>
        <Text style={styles.distance} testID="record-distance">{distanceText}</Text>
        {distanceNote ? <Text style={styles.note} testID="record-distance-note">{distanceNote}</Text> : null}

        {profile.display === "pace" ? (
          <Text style={styles.metric} testID="record-pace">
            {t("Pace")} {pace === null ? t("Not measured") : t("{pace} min/km", { pace: formatPace(pace) })}
          </Text>
        ) : (
          <Text style={styles.metric} testID="record-speed">
            {t("Speed")} {speed === null
              ? t("Not measured")
              : t("{speed} km/h", { speed: formatNumber(speed, { maximumFractionDigits: 1 }) })}
          </Text>
        )}

        <View style={styles.pair}>
          <View style={styles.pairCell} testID="record-steps">
            <Text style={styles.word}>{t("Steps")}</Text>
            <Text style={styles.figure}>{steps === null ? t("Not measured") : formatNumber(steps)}</Text>
            {steps !== null ? <Text style={styles.note}>{t("Phone steps")}</Text> : null}
          </View>
          <View style={styles.pairCell} testID="record-elevation">
            <Text style={styles.word}>{t("Elevation")}</Text>
            <Text style={styles.figure}>
              {elevation.seen
                ? t("{count} m", { count: formatNumber(Math.round(elevation.gain)) })
                : t("Not measured")}
            </Text>
            {elevation.seen ? <Text style={styles.note}>{t("Barometer")}</Text> : null}
          </View>
        </View>

        <Text style={styles.word}>{t("Route")}</Text>
        {hasLine ? (
          <View style={styles.route}>
            <RouteSketch segments={track.segments} testID="record-route" />
          </View>
        ) : (
          <Text style={styles.note} testID="record-route">{t("No route")}</Text>
        )}

        {location === "off" && phase !== "idle" ? (
          <View style={styles.banner}>
            {canAskAgain ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  sensorGen.current += 1;
                  void beginSensors(sensorGen.current);
                }}
                style={(state) => [styles.bannerBtn, pressableStyle(state, { variant: "surface", reduceMotion })]}
                testID="record-allow-location"
              >
                <Text style={styles.bannerBtnTxt}>{t("ALLOW LOCATION")}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("OPEN SETTINGS")}
              onPress={() => void Linking.openSettings()}
              style={(state) => [styles.bannerBtn, pressableStyle(state, { variant: "surface", reduceMotion })]}
              testID="record-location-settings"
            >
              <Text style={styles.bannerBtnTxt}>{t("OPEN SETTINGS")}</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? <Text accessibilityRole="alert" style={styles.error} testID="record-error">{error}</Text> : null}

        {phase === "idle" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("START")}
            onPress={start}
            style={(state) => [styles.start, pressableStyle(state, { variant: "primary", reduceMotion })]}
            testID="record-start"
          >
            <Text style={styles.startTxt}>{t("START")}</Text>
          </Pressable>
        ) : (
          <View style={styles.actions}>
            {phase === "recording" ? (
              <Pressable
                accessibilityRole="button"
                onPress={pause}
                style={(state) => [styles.secondary, pressableStyle(state, { variant: "surface", reduceMotion })]}
                testID="record-pause"
              >
                <Text style={styles.secondaryTxt}>{t("PAUSE")}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={start}
                style={(state) => [styles.secondary, pressableStyle(state, { variant: "surface", reduceMotion })]}
                testID="record-resume"
              >
                <Text style={styles.secondaryTxt}>{t("RESUME")}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("FINISH")}
              disabled={!canFinish}
              onPress={finish}
              style={(state) => [
                styles.start,
                styles.finish,
                !canFinish && styles.finishOff,
                pressableStyle(state, { variant: "primary", reduceMotion, disabled: !canFinish }),
              ]}
              testID="record-finish"
            >
              <Text style={[styles.startTxt, !canFinish && styles.finishOffTxt]}>
                {saving ? t("SAVING...") : t("FINISH")}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  kicker: { color: colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  chips: { gap: spacing.sm, paddingBottom: spacing.sm },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.surface2, borderColor: colors.text },
  chipTxt: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  chipTxtOn: { color: colors.text },
  note: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  clock: { color: colors.hero, fontSize: 64, fontWeight: "800", letterSpacing: -1, marginTop: spacing.lg, fontVariant: ["tabular-nums"] },
  distance: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.sm },
  metric: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: spacing.md },
  pair: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  pairCell: { flex: 1 },
  word: { color: colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: spacing.lg },
  figure: { color: colors.text, fontSize: 22, fontWeight: "800", marginTop: spacing.xs },
  route: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  banner: { marginTop: spacing.md, gap: spacing.sm },
  bannerTxt: { color: colors.text, fontSize: 14 },
  bannerBtn: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  bannerBtnTxt: { color: colors.text, fontWeight: "800", letterSpacing: 0.4 },
  error: { color: colors.error, marginTop: spacing.md },
  start: {
    minHeight: 52,
    marginTop: spacing.xl,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  startTxt: { color: colors.brandOn, fontWeight: "800", letterSpacing: 1 },
  actions: { flexDirection: "row", gap: spacing.sm },
  finish: { flex: 1, marginTop: spacing.xl },
  finishOff: { backgroundColor: colors.surface },
  finishOffTxt: { color: colors.textMuted },
  secondary: {
    flex: 1,
    minHeight: 52,
    marginTop: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryTxt: { color: colors.text, fontWeight: "800", letterSpacing: 1 },
});
