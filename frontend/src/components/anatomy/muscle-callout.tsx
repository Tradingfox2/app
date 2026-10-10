import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type { BodySide } from "./muscle-types";
import { parseViewBox, type Point } from "./callout-geometry";
import { BACK_VIEWBOX, FRONT_VIEWBOX } from "./anatomy-artwork";
import { colors, fonts } from "../../theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Drawn leader. Longer than theme.motion.slow so the stroke can be read, still inside 250–450ms. */
export const CALLOUT_LINE_MS = 320;
export const CALLOUT_FADE_MS = 140;
export const CALLOUT_STAGGER_MS = 90;
export const CALLOUT_OUT_MS = 120;

const EASE = Easing.out(Easing.cubic);

export type CalloutSequence = {
  shownKey: string | null;
  line: SharedValue<number>;
  name: SharedValue<number>;
  role: SharedValue<number>;
  freq: SharedValue<number>;
};

export function useCalloutSequence(activeKey: string | null, reduceMotion: boolean): CalloutSequence {
  const line = useSharedValue(0);
  const name = useSharedValue(0);
  const role = useSharedValue(0);
  const freq = useSharedValue(0);
  const shownRef = useRef<string | null>(null);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const token = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      cancelAnimation(line);
      cancelAnimation(name);
      cancelAnimation(role);
      cancelAnimation(freq);
    };
    const begin = (next: string | null) => {
      if (generation.current !== token) return;
      shownRef.current = next;
      setShownKey(next);
      stop();
      if (!next) {
        line.value = 0;
        name.value = 0;
        role.value = 0;
        freq.value = 0;
        return;
      }
      if (reduceMotion) {
        line.value = 1;
        name.value = 1;
        role.value = 1;
        freq.value = 1;
        return;
      }
      line.value = 0;
      name.value = 0;
      role.value = 0;
      freq.value = 0;
      line.value = withTiming(1, { duration: CALLOUT_LINE_MS, easing: EASE });
      name.value = withDelay(CALLOUT_LINE_MS, withTiming(1, { duration: CALLOUT_FADE_MS, easing: EASE }));
      role.value = withDelay(
        CALLOUT_LINE_MS + CALLOUT_STAGGER_MS,
        withTiming(1, { duration: CALLOUT_FADE_MS, easing: EASE }),
      );
      freq.value = withDelay(
        CALLOUT_LINE_MS + CALLOUT_STAGGER_MS * 2,
        withTiming(1, { duration: CALLOUT_FADE_MS, easing: EASE }),
      );
    };

    const previous = shownRef.current;
    if (previous && previous !== activeKey && !reduceMotion) {
      stop();
      line.value = withTiming(0, { duration: CALLOUT_OUT_MS, easing: EASE });
      name.value = withTiming(0, { duration: CALLOUT_OUT_MS, easing: EASE });
      role.value = withTiming(0, { duration: CALLOUT_OUT_MS, easing: EASE });
      freq.value = withTiming(0, { duration: CALLOUT_OUT_MS, easing: EASE });
      timer = setTimeout(() => begin(activeKey), CALLOUT_OUT_MS);
    } else {
      begin(activeKey);
    }

    return () => {
      generation.current += 1;
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [activeKey, freq, line, name, reduceMotion, role]);

  return { shownKey, line, name, role, freq };
}

/** Extra viewBox gutter so the leader's outer segment stays inside the same scale as the body. */
export function calloutSvgBox(side: BodySide, gutter: "left" | "right"): { viewBox: string; scale: number } {
  const frame = parseViewBox(side === "front" ? FRONT_VIEWBOX : BACK_VIEWBOX);
  const extra = 28;
  const minX = gutter === "left" ? frame.minX - extra : frame.minX;
  const width = frame.width + extra;
  return {
    viewBox: `${minX} ${frame.minY} ${width} ${frame.height}`,
    scale: width / frame.width,
  };
}

function leaderPath(points: readonly Point[]): { d: string; length: number } {
  if (points.length < 2) return { d: "", length: 0 };
  let length = 0;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    d += ` L ${points[index].x.toFixed(2)} ${points[index].y.toFixed(2)}`;
  }
  return { d, length };
}

export function CalloutLeader({
  points,
  progress,
  width,
  height,
  viewBox,
}: {
  points: readonly Point[];
  progress: SharedValue<number>;
  width: number;
  height: number;
  viewBox: string;
}) {
  const { d, length } = leaderPath(points);
  const origin = points[0];
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - progress.value),
  }));
  if (!d || !origin) return null;
  return (
    <Svg
      width={width}
      height={height}
      viewBox={viewBox}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    >
      <AnimatedPath
        d={d}
        stroke={colors.brand}
        strokeWidth={1.25}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="nonScalingStroke"
        strokeDasharray={`${length} ${length}`}
        animatedProps={animatedProps}
        testID="muscle-callout-leader"
      />
      <Circle cx={origin.x} cy={origin.y} r={11} fill={colors.brand} />
    </Svg>
  );
}

export function MuscleCalloutLabel({
  name,
  role,
  sessions,
  sets,
  sequence,
  compact = false,
  align = "left",
}: {
  name: string;
  role: string;
  sessions: string;
  sets: string;
  sequence: CalloutSequence;
  compact?: boolean;
  align?: "left" | "right";
}) {
  const nameStyle = useAnimatedStyle(() => ({ opacity: sequence.name.value }));
  const roleStyle = useAnimatedStyle(() => ({ opacity: sequence.role.value }));
  const freqStyle = useAnimatedStyle(() => ({ opacity: sequence.freq.value }));
  const spoken = `${name}. ${role}. ${sessions}. ${sets}`;
  return (
    <View
      testID="muscle-callout"
      accessibilityLiveRegion="polite"
      accessibilityRole="summary"
      accessibilityLabel={spoken}
      style={[styles.block, compact && styles.blockCompact, align === "right" && styles.alignRight]}
    >
      <View style={[styles.tick, align === "right" && styles.tickRight]} />
      <Animated.Text
        testID="muscle-callout-name"
        style={[styles.name, compact && styles.nameCompact, nameStyle, align === "right" && styles.rightText]}
        numberOfLines={2}
      >
        {name}
      </Animated.Text>
      <Animated.Text
        testID="muscle-callout-role"
        style={[styles.role, roleStyle, align === "right" && styles.rightText]}
        numberOfLines={3}
      >
        {role}
      </Animated.Text>
      <Animated.Text
        testID="muscle-callout-sessions"
        style={[styles.sessions, freqStyle, align === "right" && styles.rightText]}
      >
        {sessions}
      </Animated.Text>
      <Animated.Text
        testID="muscle-callout-sets"
        style={[styles.sets, freqStyle, align === "right" && styles.rightText]}
      >
        {sets}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    width: 176,
    gap: 2,
    paddingLeft: 10,
  },
  blockCompact: {
    width: "100%",
    paddingLeft: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  alignRight: {
    paddingLeft: 0,
    paddingRight: 10,
  },
  tick: {
    width: 18,
    height: 1.5,
    backgroundColor: colors.brand,
    marginBottom: 4,
  },
  tickRight: {
    alignSelf: "flex-end",
  },
  name: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  nameCompact: {
    fontSize: 18,
    lineHeight: 20,
  },
  role: {
    color: colors.textMuted,
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 17,
  },
  sessions: {
    color: colors.brand,
    fontFamily: fonts.numeric,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  sets: {
    color: colors.text,
    fontFamily: fonts.numeric,
    fontSize: 12,
    lineHeight: 16,
  },
  rightText: {
    textAlign: "right",
  },
});
