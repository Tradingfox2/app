import React from "react";
import { ClipPath, Defs, G, Path } from "react-native-svg";
import type { MuscleSlug, ActivationLevel } from "./muscle-types";
import { MUSCLE_NAMES, type MusclePathDefinition } from "./anatomy-artwork";
import { colors } from "../../theme";

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
  untrained: "#2A3140",
  low: "#0E7490",
  productive: "#15803D",
  high: "#C2410C",
  overreaching: "#BE123C",
};

const ACTIVATION_COLORS: Record<ActivationLevel, string> = {
  primary: colors.brand,
  secondary: colors.volt,
  stabilizer: colors.blaze,
};

type MuscleRegionProps = {
  definition: MusclePathDefinition;
  loadPercent: number;
  selected: boolean;
  activation?: ActivationLevel;
  interactive: boolean;
  animateFibers: boolean;
  reduceMotion: boolean;
  glow?: number;
  bloomFilter?: string;
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
  glow = 1,
  onPress,
}: MuscleRegionProps) {
  const state = loadState(loadPercent);
  const lit = Boolean(activation) || selected;
  const fill = activation
    ? ACTIVATION_COLORS[activation]
    : selected
      ? colors.brand
      : LOAD_COLORS[state];
  const clipId = `clip-${definition.id}`;
  const muscleName = MUSCLE_NAMES[definition.slug];
  const accessibilityLabel = `${muscleName}, ${state} load${selected ? ", selected" : ""}`;
  const pressProps = interactive
    ? {
        onPress,
        accessibilityRole: "button" as const,
        accessibilityLabel,
        accessibilityState: { selected },
      }
    : {};
  const pulse = reduceMotion || !lit ? 1 : 0.78 + glow * 0.22;

  return (
    <G>
      <Defs>
        <ClipPath id={clipId}>
          <Path d={definition.path} />
        </ClipPath>
      </Defs>

      {lit ? (
        <Path
          d={definition.path}
          fill="none"
          stroke={fill}
          strokeWidth={selected ? 5 : 3.2}
          strokeOpacity={0.22 * pulse}
          strokeLinejoin="round"
          strokeLinecap="round"
          pointerEvents="none"
        />
      ) : null}

      <Path
        id={definition.id}
        d={definition.path}
        fill={fill}
        fillOpacity={
          selected
            ? 0.62 * pulse
            : activation === "primary"
              ? 0.55 * pulse
              : activation
                ? 0.42 * pulse
                : 1
        }
        stroke={lit ? fill : "#3F4654"}
        strokeWidth={selected ? 1.6 : lit ? 1.1 : 0.5}
        strokeOpacity={lit ? 0.9 : 1}
        pointerEvents="auto"
        data-muscle-slug={definition.slug}
        {...pressProps}
      />

      {animateFibers && !lit && (
        <G clipPath={`url(#${clipId})`} pointerEvents="none">
          <Path
            d={definition.path}
            stroke="#64748B"
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
            strokeOpacity={0.22}
            strokeDasharray="7 5"
          />
        </G>
      )}
    </G>
  );
}

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
