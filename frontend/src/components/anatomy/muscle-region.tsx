import React, { useEffect, useRef } from "react";
import { Animated, Pressable } from "react-native";
import { ClipPath, Defs, G, Path } from "react-native-svg";
import type { MuscleSlug, ActivationLevel } from "./muscle-types";
import { MUSCLE_NAMES, type MusclePathDefinition } from "./anatomy-artwork";
import { colors } from "../../theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type LoadState =
  | "untrained"
  | "low"
  | "productive"
  | "high"
  | "overreaching";

export function loadState(percent: number): LoadState {
  if (percent <= 0) return "untrained";
  if (percent < 35) return "low";
  if (percent < 70) return "productive";
  if (percent < 85) return "high";
  return "overreaching";
}

const LOAD_COLORS: Record<LoadState, string> = {
  untrained: "#E8E8E8",
  low: "#90CAF9",
  productive: "#66BB6A",
  high: "#FFB74D",
  overreaching: "#EF5350",
};

const ACTIVATION_OPACITY: Record<ActivationLevel, number> = {
  primary: 1.0,
  secondary: 0.65,
  stabilizer: 0.35,
};

type MuscleRegionProps = {
  definition: MusclePathDefinition;
  loadPercent: number;
  selected: boolean;
  activation?: ActivationLevel;
  interactive: boolean;
  animateFibers: boolean;
  reduceMotion: boolean;
  onPress?: () => void;
};

export function MuscleRegion({
  definition,
  loadPercent,
  selected,
  activation,
  interactive,
  animateFibers,
  reduceMotion,
  onPress,
}: MuscleRegionProps) {
  const state = loadState(loadPercent);
  const tintColor = LOAD_COLORS[state];
  const clipId = `clip-${definition.id}`;

  // Animation values
  const selectionScale = useRef(new Animated.Value(1)).current;
  const tintOpacity = useRef(new Animated.Value(0.3)).current;
  const fiberOffset = useRef(new Animated.Value(0)).current;

  // Activation animation
  useEffect(() => {
    if (!activation) {
      // Reset to default state
      if (reduceMotion) {
        selectionScale.setValue(1);
        tintOpacity.setValue(0.3);
        fiberOffset.setValue(0);
      } else {
        Animated.parallel([
          Animated.timing(selectionScale, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(tintOpacity, {
            toValue: 0.3,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();
      }
      return;
    }

    const targetOpacity = ACTIVATION_OPACITY[activation];

    if (reduceMotion) {
      selectionScale.setValue(1.03);
      tintOpacity.setValue(targetOpacity);
      fiberOffset.setValue(20);
      return;
    }

    // One-shot activation sequence (450-650ms)
    const sequence = Animated.sequence([
      // Phase 1: Quick scale up and tint (150ms)
      Animated.parallel([
        Animated.timing(selectionScale, {
          toValue: 1.05,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(tintOpacity, {
          toValue: targetOpacity,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
      // Phase 2: Fiber animation (300ms)
      Animated.parallel([
        Animated.timing(fiberOffset, {
          toValue: 20,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(selectionScale, {
          toValue: 1.03,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      // Phase 3: Settle (100ms)
      Animated.timing(selectionScale, {
        toValue: 1.02,
        duration: 100,
        useNativeDriver: true,
      }),
    ]);

    sequence.start();

    return () => {
      sequence.stop();
    };
  }, [activation, reduceMotion, selectionScale, tintOpacity, fiberOffset]);

  // Selection highlight animation
  useEffect(() => {
    if (!selected) return;

    if (reduceMotion) {
      selectionScale.setValue(1.02);
      return;
    }

    Animated.sequence([
      Animated.timing(selectionScale, {
        toValue: 1.04,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(selectionScale, {
        toValue: 1.02,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [selected, reduceMotion, selectionScale]);

  const muscleName = MUSCLE_NAMES[definition.slug];
  const accessibilityLabel = `${muscleName}, ${state} load${selected ? ", selected" : ""}`;

  return (
    <G>
      <Defs>
        <ClipPath id={clipId}>
          <Path d={definition.path} />
        </ClipPath>
      </Defs>

      {/* Base anatomical gradient path */}
      <Path
        d={definition.path}
        fill="#F5E6D3"
        stroke="#D4C4B0"
        strokeWidth={0.5}
      />

      {/* Load tint overlay */}
      <AnimatedPath
        d={definition.path}
        fill={tintColor}
        fillOpacity={tintOpacity}
      />

      {/* Fiber paths (clipped to muscle contour) */}
      {animateFibers && (
        <G clipPath={`url(#${clipId})`}>
          <AnimatedPath
            d={definition.fiberPath}
            stroke="#8B7355"
            strokeWidth={1.5}
            strokeLinecap="round"
            fill="none"
            strokeOpacity={0.4}
            strokeDasharray="8 4"
            strokeDashoffset={fiberOffset}
          />
        </G>
      )}

      {/* Selection outline */}
      {selected && (
        <Path
          d={definition.path}
          fill="none"
          stroke={colors.accent}
          strokeWidth={2}
        />
      )}

      {/* Transparent hit target (larger for better touch) */}
      {interactive && (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ selected }}
        >
          <Path
            d={definition.path}
            fill="transparent"
            stroke="transparent"
            strokeWidth={12}
          />
        </Pressable>
      )}
    </G>
  );
}

// Utility to get grouped regions by muscle slug
export function groupRegionsBySlug(
  definitions: MusclePathDefinition[],
): Map<MuscleSlug, MusclePathDefinition[]> {
  const map = new Map<MuscleSlug, MusclePathDefinition[]>();
  for (const def of definitions) {
    const existing = map.get(def.slug) || [];
    existing.push(def);
    map.set(def.slug, existing);
  }
  return map;
}
