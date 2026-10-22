import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useReducedMotion } from "@/src/affordance";
import { colors } from "@/src/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** One progress ring that fills from 0 to `progress` (0..1). Static under reduce-motion. */
export function ProgressRing({
  size, stroke, progress, color, track = colors.surface3, delay = 0,
}: { size: number; stroke: number; progress: number; color: string; track?: string; delay?: number }) {
  const reduceMotion = useReducedMotion();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fill = useSharedValue(reduceMotion ? progress : 0);
  useEffect(() => {
    const target = Math.max(0, Math.min(1, progress));
    fill.value = reduceMotion ? target : withTiming(target, { duration: 900 + delay, easing: Easing.out(Easing.cubic) });
  }, [progress, reduceMotion, fill, delay]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - fill.value) }));
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <AnimatedCircle
        cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
        strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} animatedProps={animatedProps}
      />
    </Svg>
  );
}

/** Weekly goals as three concentric rings: workouts, active days, steps. */
export function GoalRings({ rings, size = 132 }: { rings: { progress: number; color: string }[]; size?: number }) {
  const stroke = 12;
  return (
    <View style={{ width: size, height: size }}>
      {rings.map((ring, i) => {
        const inner = size - i * (stroke + 4) * 2;
        return (
          <View key={i} style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
            <ProgressRing size={inner} stroke={stroke} progress={ring.progress} color={ring.color} delay={i * 150} />
          </View>
        );
      })}
    </View>
  );
}

/** Horizontal XP bar that grows into place. */
export function XpBar({ progress, color = colors.brand, height = 10 }: { progress: number; color?: string; height?: number }) {
  const reduceMotion = useReducedMotion();
  const width = useSharedValue(reduceMotion ? progress : 0);
  useEffect(() => {
    const target = Math.max(0, Math.min(1, progress));
    width.value = reduceMotion ? target : withTiming(target, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [progress, reduceMotion, width]);
  const style = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color }, style]} />
    </View>
  );
}

/** A flame that breathes while the streak is alive and pops when today counts. */
export function StreakFlame({ days, alive, atRisk, size = 44 }: { days: number; alive: boolean; atRisk: boolean; size?: number }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion || !alive) {
      pulse.value = 1;
      return;
    }
    pulse.value = withSequence(
      withTiming(1.35, { duration: 220 }),
      withRepeat(withSequence(withTiming(1.0, { duration: 700 }), withTiming(1.1, { duration: 700 })), -1, true),
    );
  }, [alive, days, reduceMotion, pulse]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const color = !alive ? colors.textDim : atRisk ? colors.warning : colors.live;
  return (
    <Animated.View style={style}>
      <Ionicons name={alive ? "flame" : "flame-outline"} size={size} color={color} />
    </Animated.View>
  );
}

export function RingLabel({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={styles.ringValue}>{value}</Text>
      <Text style={styles.ringLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: "100%", backgroundColor: colors.surface3, overflow: "hidden" },
  ringValue: { color: colors.hero, fontSize: 30, fontWeight: "800" },
  ringLabel: { color: colors.textMuted, fontSize: 11, letterSpacing: 1 },
});
