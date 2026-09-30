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
  primary: colors.text,
  secondary: colors.volt,
  stabilizer: colors.blaze,
};

const fiberGuides = new Map<string, string>();

/** Interior strokes along the muscle's long axis. Clipped to the region so they read as fibers. */
function fiberGuide(id: string, path: string): string {
  const cached = fiberGuides.get(id);
  if (cached !== undefined) return cached;
  const nums = path.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 4) {
    fiberGuides.set(id, "");
    return "";
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 8 || height < 8) {
    fiberGuides.set(id, "");
    return "";
  }
  const vertical = height >= width;
  const count = 5;
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i / (count + 1);
    if (vertical) {
      const x = minX + width * t;
      const lean = width * 0.12;
      lines.push(`M ${x - lean} ${minY} L ${x + lean} ${maxY}`);
    } else {
      const y = minY + height * t;
      const lean = height * 0.12;
      lines.push(`M ${minX} ${y + lean} L ${maxX} ${y - lean}`);
    }
  }
  const guide = lines.join(" ");
  fiberGuides.set(id, guide);
  return guide;
}

type MuscleRegionProps = {
  definition: MusclePathDefinition;
  loadPercent: number;
  selected: boolean;
  activation?: ActivationLevel;
  interactive: boolean;
  animateFibers: boolean;
  reduceMotion: boolean;
  glow?: number;
  /** 0–1 progress of the one-shot fiber sweep after selection. */
  sweep?: number;
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
  sweep = 0,
  onPress,
}: MuscleRegionProps) {
  const state = loadState(loadPercent);
  const lit = Boolean(activation) || selected;
  const fill = activation
    ? ACTIVATION_COLORS[activation]
    : selected
      ? colors.text
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
  const guide = fiberGuide(definition.id, definition.path);
  const sweeping = selected && !reduceMotion && sweep > 0 && sweep < 1;
  const showFibers = Boolean(guide) && (animateFibers || selected);

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

      {showFibers ? (
        <G clipPath={`url(#${clipId})`} pointerEvents="none">
          <Path
            d={guide}
            stroke={lit ? "#FFF4EA" : "#E7C4B0"}
            strokeWidth={sweeping ? 2.4 : 1.35}
            strokeLinecap="round"
            fill="none"
            strokeOpacity={sweeping ? 0.85 : lit ? 0.45 : 0.34}
            strokeDasharray={sweeping ? "14 36" : undefined}
            strokeDashoffset={sweeping ? (1 - sweep) * 50 : 0}
          />
        </G>
      ) : null}
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
