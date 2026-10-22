import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { api } from "@/src/api";
import { pressableStyle, useReducedMotion } from "@/src/affordance";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import type { ProgressSummary } from "@/src/progress-types";
import { ProgressRing, StreakFlame, XpBar } from "./Rings";
import { STAGE_LABELS } from "./labels";

/** A real progress payload (a mocked or older API can answer something else). */
export function isProgressSummary(value: unknown): value is ProgressSummary {
  const v = value as ProgressSummary | null;
  return Boolean(v && typeof v.level === "number" && typeof v.progress === "number" && v.streak && typeof v.streak.current === "number");
}

/** Compact Home card: level ring, XP bar, streak flame. Opens the Progress hub. */
export function ProgressEntry() {
  const { t, formatNumber } = useI18n();
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState<ProgressSummary | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      api.progress().then((value) => live && setData(isProgressSummary(value) ? value : null)).catch(() => undefined);
      return () => {
        live = false;
      };
    }, []),
  );
  if (!data) return null;
  return (
    <Pressable
      testID="home-progress-card"
      accessibilityRole="button"
      accessibilityLabel={t("Open progress and rewards")}
      onPress={() => router.push("/progress" as Href)}
      style={(state) => [styles.card, pressableStyle(state, { variant: "quiet", reduceMotion })]}
    >
      <View style={styles.ring}>
        <ProgressRing size={56} stroke={6} progress={data.progress} color={colors.brand} />
        <Text style={styles.level}>{formatNumber(data.level)}</Text>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.title}>
          {t("LEVEL {level}", { level: formatNumber(data.level) })} · {t(STAGE_LABELS[data.stage] ?? data.stage)}
        </Text>
        <XpBar progress={data.progress} height={8} />
        <Text style={styles.meta}>
          {t("{xp} / {next} XP", { xp: formatNumber(data.xp), next: formatNumber(data.next_level_xp) })}
        </Text>
      </View>
      <View style={styles.flame}>
        <StreakFlame days={data.streak.current} alive={data.streak.current > 0} atRisk={data.streak.at_risk} size={28} />
        <Text style={styles.flameNum}>{formatNumber(data.streak.current)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  ring: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  level: { position: "absolute", color: colors.hero, fontWeight: "800", fontSize: 18 },
  title: { color: colors.text, fontWeight: "700", fontSize: 13, letterSpacing: 0.8 },
  meta: { color: colors.textMuted, fontSize: 12 },
  flame: { alignItems: "center", minWidth: 44 },
  flameNum: { color: colors.text, fontWeight: "800", fontSize: 14 },
});
