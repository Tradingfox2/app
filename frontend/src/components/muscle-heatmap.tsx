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
import { colors, spacing } from "@/src/theme";
import { AnatomyBody } from "@/src/components/anatomy/anatomy-body";
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
}: Props) {
  const { t } = useI18n();
  const mapped = volumes as Partial<Record<MuscleSlug, number>>;
  const yaw = useRef(new Animated.Value(0.5)).current;
  const shouldSpin = spinning && !reduceMotion;
  const useNative = Platform.OS !== "web";

  useEffect(() => {
    if (!shouldSpin) {
      yaw.stopAnimation();
      Animated.timing(yaw, {
        toValue: 0.5,
        duration: 350,
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
  }, [shouldSpin, yaw, useNative]);

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
        />
        <BodyColumn
          label={t("BACK")}
          side="back"
          emphasized={emphasize === "back"}
          rotateY={rotateYBack}
          bodyProps={bodyProps}
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
          style={styles.explorePrompt}
        >
          <Text style={styles.exploreText}>{t("Explore muscles")}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accent} />
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
}: {
  label: string;
  side: BodySide;
  emphasized: boolean;
  rotateY: Animated.AnimatedInterpolation<string | number>;
  bodyProps: Omit<React.ComponentProps<typeof AnatomyBody>, "side">;
}) {
  return (
    <View style={styles.bodyBlock} testID={`body-${side}`}>
      <Animated.View
        style={[
          styles.bodyFrame,
          emphasized && styles.bodyFrameOn,
          { transform: [{ perspective: 600 }, { rotateY }] },
        ]}
      >
        <AnatomyBody {...bodyProps} side={side} />
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
  bodyFrameOn: {
    borderWidth: 1,
    borderColor: colors.brand,
  },
  bodyLbl: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  bodyLblOn: { color: colors.brand },
  selectedName: {
    color: colors.brand,
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
    color: colors.accent,
    fontSize: 13,
    fontWeight: "600",
  },
});
