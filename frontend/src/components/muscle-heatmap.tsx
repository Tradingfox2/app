import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { pressableStyle, useReducedMotion } from "@/src/affordance";
import { colors, spacing } from "@/src/theme";
import { AnatomyBody } from "@/src/components/anatomy/anatomy-body";
import { CalloutLeader, calloutSvgBox, type CalloutSequence } from "@/src/components/anatomy/muscle-callout";
import { parseViewBox, type Point } from "@/src/components/anatomy/callout-geometry";
import type {
  ActivationMap,
  BodySide,
  MuscleSlug,
} from "@/src/components/anatomy/muscle-types";
import { MUSCLE_NAMES } from "@/src/components/anatomy/anatomy-artwork";
import { useI18n } from "@/src/i18n";

const YAW_MS = 8000;
// The idle "spin" is a gentle ±18° yaw driven by Animated on every platform.
// (A CSS class approach was tried before, but react-native-web drops the
// `className` prop, so nothing ever rotated on web.) The JS driver is used on
// web because the native driver is not available there; the rotation only
// touches the wrapper's transform, so the SVG muscles stay fully tappable.

type Props = {
  volumes: Record<string, number> | Partial<Record<MuscleSlug, number>>;
  max: number;
  selectedMuscle?: MuscleSlug | null;
  activation?: ActivationMap;
  spinning?: boolean;
  reduceMotion?: boolean;
  emphasize?: BodySide | null;
  bodyWidth?: number;
  bodyHeight?: number;
  showLegend?: boolean;
  showStatus?: boolean;
  onPress?: () => void;
  onMusclePress?: (muscle: MuscleSlug) => void;
  /** Home-only hover and press. Other callers keep today's static prompt. */
  affordance?: boolean;
  /**
   * Explorer-only anatomical callout. Home leaves this unset, so the preview
   * stays a plain pair of figures.
   */
  callout?: {
    side: BodySide;
    gutter: "left" | "right";
    leader: readonly Point[];
    line: CalloutSequence["line"];
    placement: "beside" | "below";
    label: React.ReactNode;
  } | null;
};

export function MuscleHeatmap({
  volumes,
  max,
  selectedMuscle = null,
  activation,
  spinning = true,
  reduceMotion = false,
  emphasize = null,
  bodyWidth = 150,
  bodyHeight = 300,
  showLegend = true,
  showStatus = true,
  onPress,
  onMusclePress,
  affordance = false,
  callout = null,
}: Props) {
  const { t } = useI18n();
  const softenMotion = useReducedMotion();
  const mapped = volumes as Partial<Record<MuscleSlug, number>>;
  const yaw = useRef(new Animated.Value(0.5)).current;
  const shouldSpin = spinning && !reduceMotion;
  const holdYaw = callout != null;
  const useNative = Platform.OS !== "web";

  useEffect(() => {
    if (!shouldSpin) {
      yaw.stopAnimation();
      Animated.timing(yaw, {
        toValue: 0.5,
        duration: holdYaw ? 200 : 350,
        easing: Easing.out(Easing.quad),
        useNativeDriver: useNative,
      }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(yaw, {
          toValue: 1,
          duration: YAW_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: useNative,
        }),
        Animated.timing(yaw, {
          toValue: 0,
          duration: YAW_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: useNative,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [holdYaw, shouldSpin, yaw, useNative]);

  const rotateY = yaw.interpolate({
    inputRange: [0, 1],
    outputRange: ["-18deg", "18deg"],
  });
  // The back body yaws in counter-phase so the pair reads as one turning figure.
  const rotateYBack = yaw.interpolate({
    inputRange: [0, 1],
    outputRange: ["18deg", "-18deg"],
  });

  const bodyProps = {
    volumes: mapped,
    max,
    selectedMuscle,
    activation,
    interactive: !!onMusclePress,
    animateFibers: true,
    reduceMotion,
    onMusclePress,
    width: bodyWidth,
    height: bodyHeight,
  } as const;

  return (
    <View style={styles.wrap} testID="muscle-heatmap">
      <View style={styles.bodies}>
        <BodyColumn
          label={t("FRONT")}
          side="front"
          emphasized={emphasize === "front"}
          rotateY={rotateY}
          bodyProps={bodyProps}
          callout={callout?.side === "front" ? callout : null}
        />
        <BodyColumn
          label={t("BACK")}
          side="back"
          emphasized={emphasize === "back"}
          rotateY={rotateYBack}
          bodyProps={bodyProps}
          callout={callout?.side === "back" ? callout : null}
        />
      </View>
      {showStatus && selectedMuscle ? (
        <Text style={styles.selectedName}>
          {t("{name} · tap another muscle or explore", { name: MUSCLE_NAMES[selectedMuscle] })}
        </Text>
      ) : null}
      {showLegend ? (
      <View style={styles.legend}>
        <Text style={styles.legendTxt}>{t("LOW")}</Text>
        <View style={[styles.legendChip, { backgroundColor: "#0E7490" }]} />
        <View style={[styles.legendChip, { backgroundColor: "#15803D" }]} />
        <View style={[styles.legendChip, { backgroundColor: "#C2410C" }]} />
        <View style={[styles.legendChip, { backgroundColor: "#BE123C" }]} />
        <Text style={styles.legendTxt}>{t("HIGH")}</Text>
      </View>
      ) : null}
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={t("Open muscle explorer")}
          style={
            affordance
              ? (state) => [styles.explorePrompt, pressableStyle(state, { variant: "quiet", reduceMotion: softenMotion })]
              : styles.explorePrompt
          }
        >
          <Text style={styles.exploreText}>{t("Explore muscles")}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

function BodyColumn({
  label,
  side,
  emphasized,
  rotateY,
  bodyProps,
  callout,
}: {
  label: string;
  side: BodySide;
  emphasized: boolean;
  rotateY: Animated.AnimatedInterpolation<string | number>;
  bodyProps: Omit<React.ComponentProps<typeof AnatomyBody>, "side">;
  callout: Props["callout"];
}) {
  const width = bodyProps.width ?? 280;
  const height = bodyProps.height ?? 560;
  const framed = callout ? calloutSvgBox(side, callout.gutter) : null;
  const svgWidth = framed ? width * framed.scale : width;
  const showBeside = Boolean(callout && callout.placement === "beside" && callout.label);
  const end = callout?.leader[callout.leader.length - 1];
  const frame = framed ? parseViewBox(framed.viewBox) : null;
  // The tick sits on the leader end. Clamp so a packed slot still stays on the figure.
  const labelTop = end && frame
    ? Math.min(
        Math.max(((end.y - frame.minY) / frame.height) * height - 8, 0),
        Math.max(0, height - 88),
      )
    : 0;
  return (
    <View style={styles.bodyBlock} testID={`body-${side}`}>
      <Animated.View
        style={[
          styles.bodyFrame,
          emphasized && styles.bodyFrameOn,
          { transform: [{ perspective: 600 }, { rotateY }] },
        ]}
      >
        {callout && framed ? (
          <View style={styles.calloutRow}>
            {showBeside && callout.gutter === "left" ? (
              <View style={[styles.calloutGutter, { height }]}>
                <View style={[styles.calloutAnchor, { top: labelTop }]}>{callout.label}</View>
              </View>
            ) : null}
            <View style={{ width: svgWidth, height }}>
              <AnatomyBody {...bodyProps} side={side} width={svgWidth} height={height} viewBox={framed.viewBox} />
              <CalloutLeader
                points={callout.leader}
                progress={callout.line}
                width={svgWidth}
                height={height}
                viewBox={framed.viewBox}
              />
            </View>
            {showBeside && callout.gutter === "right" ? (
              <View style={[styles.calloutGutter, { height }]}>
                <View style={[styles.calloutAnchor, { top: labelTop }]}>{callout.label}</View>
              </View>
            ) : null}
          </View>
        ) : (
          <AnatomyBody {...bodyProps} side={side} />
        )}
      </Animated.View>
      <Text style={[styles.bodyLbl, emphasized && styles.bodyLblOn]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  bodies: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-end" },
  bodyBlock: { alignItems: "center" },
  bodyFrame: {
    borderRadius: 12,
    overflow: "visible",
  },
  calloutRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  calloutGutter: {
    width: 176,
    position: "relative",
  },
  calloutAnchor: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  bodyFrameOn: {
    borderWidth: 1,
    borderColor: colors.text,
  },
  bodyLbl: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  bodyLblOn: { color: colors.text },
  selectedName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.md,
  },
  legendTxt: { color: colors.textMuted, fontSize: 10, letterSpacing: 1 },
  legendChip: { width: 14, height: 10, borderRadius: 2 },
  explorePrompt: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  exploreText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
});
