import { createElement, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/api";
import { pressableStyle, useReducedMotion } from "@/src/affordance";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing, type } from "@/src/theme";

const SLEEP_MIN = 3;
const SLEEP_MAX = 12;
const SLEEP_SPAN = SLEEP_MAX - SLEEP_MIN;

function localDay(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sleepText(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function stepHours(raw: number): number {
  const stepped = Math.round(raw * 2) / 2;
  return Math.min(SLEEP_MAX, Math.max(SLEEP_MIN, stepped));
}

function SleepSlider({
  hours,
  label,
  onChange,
}: {
  hours: number;
  label: string;
  onChange: (hours: number) => void;
}) {
  const width = useRef(1);
  const pick = (x: number) => {
    const ratio = Math.min(1, Math.max(0, x / width.current));
    onChange(stepHours(SLEEP_MIN + ratio * SLEEP_SPAN));
  };
  if (Platform.OS === "web") {
    return createElement("input", {
      type: "range",
      min: SLEEP_MIN,
      max: SLEEP_MAX,
      step: 0.5,
      value: hours,
      "aria-label": label,
      "data-testid": "morning-sleep",
      onChange: (event: { target: { value: string } }) => onChange(stepHours(Number(event.target.value))),
      style: { width: "100%", height: 44, accentColor: colors.brand },
    });
  }
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: SLEEP_MIN, max: SLEEP_MAX, now: hours }}
      testID="morning-sleep"
      onLayout={(event) => {
        width.current = event.nativeEvent.layout.width || 1;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => pick(event.nativeEvent.locationX)}
      onResponderMove={(event) => pick(event.nativeEvent.locationX)}
      style={styles.track}
    >
      <View style={[styles.thumb, { left: `${((hours - SLEEP_MIN) / SLEEP_SPAN) * 100}%` }]} />
    </View>
  );
}

function Scale({
  label,
  value,
  testID,
  onChange,
}: {
  label: string;
  value: number | null;
  testID: string;
  onChange: (step: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.scale}>
        {[1, 2, 3, 4, 5].map((step) => {
          const selected = value === step;
          return (
            <Pressable
              key={step}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${step}`}
              accessibilityState={{ selected }}
              testID={`${testID}-${step}`}
              onPress={() => onChange(step)}
              style={(state) => [
                styles.step,
                selected ? styles.stepOn : null,
                pressableStyle(state, { variant: selected ? "primary" : "surface", reduceMotion }),
              ]}
            >
              <Text style={selected ? styles.stepTxtOn : styles.stepTxt}>{step}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function MorningCheckin() {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const [hours, setHours] = useState(8);
  const [soreness, setSoreness] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = soreness !== null && mood !== null && !saving;

  const save = async () => {
    if (soreness === null || mood === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.morningCheckin({
        sleep_hours: hours,
        soreness,
        mood,
        local_day: localDay(),
      });
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not save how you slept"));
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="morning-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Back")}
          onPress={() => router.back()}
          style={styles.back}
          testID="morning-back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.line} testID="morning-line">{t("Tell your coach how you slept.")}</Text>
        <View style={styles.block}>
          <Text style={styles.label}>{t("Sleep hours")}</Text>
          <Text style={styles.hours} testID="morning-sleep-value">{sleepText(hours)} h</Text>
          <SleepSlider hours={hours} label={t("Sleep hours")} onChange={setHours} />
        </View>
        <Scale label={t("Soreness")} value={soreness} testID="morning-soreness" onChange={setSoreness} />
        <Scale label={t("Mood")} value={mood} testID="morning-mood" onChange={setMood} />
        {error ? (
          <Text accessibilityRole="alert" style={styles.error} testID="morning-error">{error}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("SAVE CHECK-IN")}
          disabled={!ready}
          testID="morning-save"
          onPress={() => void save()}
          style={(state) => [
            styles.save,
            ready ? styles.saveOn : null,
            pressableStyle(state, { variant: "primary", reduceMotion, disabled: !ready }),
          ]}
        >
          <Text style={ready ? type.button : styles.saveTxt}>{t("SAVE CHECK-IN")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Skip for today")}
          testID="morning-skip"
          onPress={() => router.back()}
          style={(state) => [styles.skip, pressableStyle(state, { variant: "quiet", reduceMotion })]}
        >
          <Text style={styles.skipTxt}>{t("Skip for today")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  line: { ...type.body, marginBottom: spacing.xl },
  block: { marginBottom: spacing.xl },
  label: { ...type.eyebrow, marginBottom: spacing.sm },
  hours: { ...type.metric, marginBottom: spacing.sm },
  track: {
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    justifyContent: "center",
  },
  thumb: {
    position: "absolute",
    width: 28,
    height: 28,
    marginLeft: -14,
    borderRadius: 14,
    backgroundColor: colors.brand,
  },
  scale: { flexDirection: "row", gap: spacing.sm },
  step: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  stepTxt: { color: colors.text, fontSize: 16, fontWeight: "700" },
  stepTxtOn: { color: colors.brandOn, fontSize: 16, fontWeight: "700" },
  error: { color: colors.live, marginBottom: spacing.md },
  save: {
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
    marginBottom: spacing.sm,
  },
  saveOn: { backgroundColor: colors.brand },
  saveTxt: { color: colors.textMuted, fontSize: 15, fontWeight: "700" },
  skip: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  skipTxt: { color: colors.text, fontWeight: "700" },
});
