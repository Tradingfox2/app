import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { RouteSketch } from "@/src/components/route-sketch";
import { loggedMinutes } from "@/src/activity-day";
import {
  formatPace,
  paceSecPerKm,
  readStoredActivity,
  routeSketch,
  speedKmh,
  sportProfile,
  sportTitle,
  type Fix,
} from "@/src/recorder-math";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function routeFixes(value: unknown): Fix[][] {
  if (!value || typeof value !== "object") return [];
  const segments = (value as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) return [];
  const parsed: Fix[][] = [];
  for (const segment of segments) {
    if (!Array.isArray(segment)) continue;
    const fixes: Fix[] = [];
    for (const point of segment) {
      if (!point || typeof point !== "object") continue;
      const lat = (point as { lat?: unknown }).lat;
      const lng = (point as { lng?: unknown }).lng;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      fixes.push({ lat, lng, t: 0, acc: null });
    }
    if (fixes.length > 0) parsed.push(fixes);
  }
  return parsed;
}

export default function RecordSummaryScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { t, formatNumber } = useI18n();
  const [workout, setWorkout] = useState<Record<string, unknown> | null>(null);
  const [segments, setSegments] = useState<Fix[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) {
      setError(t("Could not load this recording"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setRouteError(null);
    try {
      const row = await api.workout(id);
      setWorkout(row as Record<string, unknown>);
      const activity = readStoredActivity((row as { activity?: unknown }).activity);
      if (!activity?.hasRoute) {
        setSegments([]);
        return;
      }
      try {
        const route = await api.workoutRoute(id);
        setSegments(routeFixes(route));
      } catch (cause) {
        const status = (cause as { status?: number }).status;
        if (status === 404) setSegments([]);
        else setRouteError(messageOf(cause, t("Could not load this recording")));
      }
    } catch (cause) {
      setWorkout(null);
      setError(messageOf(cause, t("Could not load this recording")));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const activity = readStoredActivity(workout?.activity);
  const movingSec = activity?.movingSec ?? null;
  const minutes = movingSec === null ? null : loggedMinutes(movingSec);
  const durationText = minutes === null
    ? movingSec !== null
      ? t("Less than 1 min")
      : t("Not measured")
    : t("{count} min", { count: formatNumber(minutes) });
  const profile = activity ? sportProfile(activity.kind) : null;
  const pace = activity && profile?.display === "pace" ? paceSecPerKm(activity.distanceM, activity.movingSec ?? 0) : null;
  const speed = activity && profile?.display === "speed" ? speedKmh(activity.distanceM, activity.movingSec ?? 0) : null;
  const lines = segments ? routeSketch(segments) : [];

  const distanceText = activity?.distanceM
    ? activity.distanceM >= 1000
      ? t("{count} km", { count: formatNumber(activity.distanceM / 1000, { maximumFractionDigits: 2 }) })
      : t("{count} m", { count: formatNumber(Math.round(activity.distanceM)) })
    : t("Not measured");

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="record-summary">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Back")}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
            hitSlop={12}
            style={styles.back}
            testID="record-summary-back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.kicker}>{activity ? t(sportTitle(activity.kind)) : t("RECORD")}</Text>
        </View>

        {loading ? <Text style={styles.note}>{t("Loading activity")}</Text> : null}
        {error ? (
          <View>
            <Text accessibilityRole="alert" style={styles.error} testID="record-summary-error">{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} testID="record-summary-retry">
              <Text style={styles.retry}>{t("Retry")}</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && workout && !activity ? (
          <Text style={styles.note} testID="record-summary-empty">{t("This session is not a recorded activity")}</Text>
        ) : null}

        {activity ? (
          <View>
            <Text style={styles.word}>{t("Duration")}</Text>
            <Text style={styles.figure} testID="summary-duration">{durationText}</Text>
            <Text style={styles.word}>{t("Distance")}</Text>
            <Text style={styles.figure} testID="summary-distance">{distanceText}</Text>
            {profile?.display === "pace" ? (
              <Text style={styles.metric} testID="summary-pace">
                {t("Pace")} {pace === null ? t("Not measured") : t("{pace} min/km", { pace: formatPace(pace) })}
              </Text>
            ) : null}
            {profile?.display === "speed" ? (
              <Text style={styles.metric} testID="summary-speed">
                {t("Speed")} {speed === null
                  ? t("Not measured")
                  : t("{speed} km/h", { speed: formatNumber(speed, { maximumFractionDigits: 1 }) })}
              </Text>
            ) : null}
            <Text style={styles.word}>{t("Steps")}</Text>
            <Text style={styles.figure} testID="summary-steps">
              {activity.steps === null ? t("Not measured") : formatNumber(activity.steps)}
            </Text>
            {activity.steps !== null ? <Text style={styles.note}>{t("Phone steps")}</Text> : null}
            <Text style={styles.word}>{t("Elevation")}</Text>
            <Text style={styles.figure} testID="summary-elevation">
              {activity.elevationGainM === null
                ? t("Not measured")
                : t("{count} m", { count: formatNumber(Math.round(activity.elevationGainM)) })}
            </Text>
            {activity.elevationGainM !== null ? <Text style={styles.note}>{t("Barometer")}</Text> : null}
            <Text style={styles.word}>{t("Route")}</Text>
            {routeError ? <Text style={styles.error} testID="summary-route-error">{routeError}</Text> : null}
            {lines.length > 0 && segments ? (
              <View style={styles.route}>
                <RouteSketch segments={segments} testID="summary-route" />
              </View>
            ) : (
              <Text style={styles.note} testID="summary-route">{t("No route")}</Text>
            )}
          </View>
        ) : null}
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
  word: { color: colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: spacing.lg },
  figure: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.xs },
  metric: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: spacing.md },
  note: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  error: { color: colors.error, marginTop: spacing.md },
  retry: { color: colors.text, fontWeight: "800", marginTop: spacing.sm },
  route: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
});
