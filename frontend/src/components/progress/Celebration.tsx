import { useEffect, useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useReducedMotion } from "@/src/affordance";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export type CelebrationKind = "level_up" | "badge" | "streak" | "challenge" | "cup" | "league";

export type CelebrationEvent = {
  kind: CelebrationKind;
  title: string;
  subtitle?: string;
};

const CONFETTI_COLORS = [colors.brand, colors.pr, colors.success, colors.info, colors.live, "#B48CF0"];

function ConfettiPiece({ index, total }: { index: number; total: number }) {
  const fall = useSharedValue(0);
  const spread = useMemo(() => ((index / total) * 2 - 1) * 170 + ((index * 37) % 23) - 11, [index, total]);
  useEffect(() => {
    fall.value = withDelay((index % 6) * 45, withTiming(1, { duration: 1500 + (index % 5) * 160, easing: Easing.out(Easing.quad) }));
  }, [fall, index]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, fall.value - 0.75) * 4,
    transform: [
      { translateX: spread * fall.value },
      { translateY: -140 + 420 * fall.value * fall.value - 40 * Math.sin(fall.value * 3.14) },
      { rotate: `${fall.value * (index % 2 ? 540 : -480)}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        styles.confetti,
        { backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length], width: index % 3 ? 8 : 12, height: index % 3 ? 14 : 8 },
        style,
      ]}
    />
  );
}

function Ray({ index, total }: { index: number; total: number }) {
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.value = withSequence(withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }), withTiming(0.0, { duration: 700 }));
  }, [grow]);
  const angle = (360 / total) * index;
  const style = useAnimatedStyle(() => ({
    opacity: grow.value,
    transform: [{ rotate: `${angle}deg` }, { translateY: -70 - 40 * grow.value }, { scaleY: 0.4 + grow.value }],
  }));
  return <Animated.View style={[styles.ray, style]} />;
}

const ICONS: Record<CelebrationKind, keyof typeof Ionicons.glyphMap> = {
  level_up: "arrow-up-circle",
  badge: "ribbon",
  streak: "flame",
  challenge: "flag",
  cup: "trophy",
  league: "podium",
};

/**
 * Full-screen celebration: level-up burst, badge unlock, streak increment,
 * challenge confetti and a trophy reveal. With reduce-motion on, the same card
 * appears instantly with no movement, no confetti and no haptic.
 */
export function Celebration({ event, onClose }: { event: CelebrationEvent | null; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const { t } = useI18n();
  const pop = useSharedValue(reduceMotion ? 1 : 0);
  const spin = useSharedValue(0);

  useEffect(() => {
    if (!event) return;
    if (reduceMotion) {
      pop.value = 1;
      spin.value = 0;
      return;
    }
    pop.value = 0;
    spin.value = 0;
    pop.value = withSpring(1, { damping: 9, stiffness: 140 });
    if (event.kind === "cup" || event.kind === "league") {
      spin.value = withSequence(withTiming(-0.06, { duration: 160 }), withSpring(0, { damping: 4, stiffness: 120 }));
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [event, reduceMotion, pop, spin]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.3 + pop.value * 0.7 }, { rotate: `${spin.value * 360}deg` }],
    opacity: Math.min(1, pop.value * 1.5),
  }));

  if (!event) return null;
  const confetti = !reduceMotion && (event.kind === "challenge" || event.kind === "cup" || event.kind === "level_up");
  const rays = !reduceMotion && (event.kind === "level_up" || event.kind === "badge" || event.kind === "league");
  const tint = event.kind === "streak" ? colors.warning : event.kind === "cup" || event.kind === "league" ? colors.pr : colors.brand;

  return (
    <Modal transparent visible animationType={reduceMotion ? "none" : "fade"} onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} testID="celebration" accessibilityRole="button"
        accessibilityLabel={`${event.title}. ${t("Tap to continue")}`}>
        <View style={styles.stage} pointerEvents="none">
          {rays ? Array.from({ length: 12 }, (_, i) => <Ray key={`r${i}`} index={i} total={12} />) : null}
          {confetti ? Array.from({ length: 36 }, (_, i) => <ConfettiPiece key={`c${i}`} index={i} total={36} />) : null}
          <Animated.View style={[styles.iconDisc, { borderColor: tint }, iconStyle]}>
            <Ionicons name={ICONS[event.kind]} size={64} color={tint} />
          </Animated.View>
        </View>
        <Text style={[styles.title, { color: tint }]} testID="celebration-title">{event.title}</Text>
        {event.subtitle ? <Text style={styles.subtitle}>{event.subtitle}</Text> : null}
        <Text style={styles.hint}>{t("Tap to continue")}</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(8, 10, 12, 0.88)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  stage: { width: 260, height: 260, alignItems: "center", justifyContent: "center" },
  iconDisc: {
    width: 128, height: 128, borderRadius: 64, borderWidth: 3, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  ray: { position: "absolute", width: 6, height: 34, borderRadius: radius.pill, backgroundColor: colors.brand },
  confetti: { position: "absolute", borderRadius: 2 },
  title: { fontSize: 28, fontWeight: "800", textAlign: "center", marginTop: spacing.lg, letterSpacing: 0.5 },
  subtitle: { color: colors.textMuted, fontSize: 16, textAlign: "center", marginTop: spacing.sm, maxWidth: 320 },
  hint: { color: colors.textDim, fontSize: 13, marginTop: spacing.xl },
});
