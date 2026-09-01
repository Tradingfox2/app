import React, { useCallback, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Svg, {
  Defs,
  G,
  LinearGradient,
  Path,
  Stop,
  Circle,
} from "react-native-svg";
import type { MuscleSlug, BodySide, ActivationMap } from "./muscle-types";
import {
  ANATOMY_VIEWBOX,
  BODY_SILHOUETTE,
  LANDMARKS,
  FRONT_MUSCLES,
  BACK_MUSCLES,
  type MusclePathDefinition,
} from "./anatomy-artwork";
import { MuscleRegion } from "./muscle-region";

export type AnatomyBodyProps = {
  side: BodySide;
  volumes: Partial<Record<MuscleSlug, number>>;
  max: number;
  selectedMuscle?: MuscleSlug | null;
  activation?: ActivationMap;
  interactive?: boolean;
  animateFibers?: boolean;
  reduceMotion?: boolean;
  onMusclePress?: (muscle: MuscleSlug) => void;
  width?: number;
  height?: number;
};

export function AnatomyBody({
  side,
  volumes,
  max,
  selectedMuscle,
  activation,
  interactive = true,
  animateFibers = true,
  reduceMotion = false,
  onMusclePress,
  width = 360,
  height = 760,
}: AnatomyBodyProps) {
  const muscles = useMemo<MusclePathDefinition[]>(
    () => (side === "front" ? FRONT_MUSCLES : BACK_MUSCLES),
    [side],
  );

  const getLoadPercent = useCallback(
    (slug: MuscleSlug): number => {
      const volume = volumes[slug] ?? 0;
      if (max <= 0 || volume <= 0) return 0;
      return Math.round((volume / max) * 100);
    },
    [volumes, max],
  );

  const handleMusclePress = useCallback(
    (slug: MuscleSlug) => {
      if (interactive && onMusclePress) {
        onMusclePress(slug);
      }
    },
    [interactive, onMusclePress],
  );

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg
        width={width}
        height={height}
        viewBox={ANATOMY_VIEWBOX}
        preserveAspectRatio="xMidYMid meet"
      >
        <Defs>
          {/* Skin gradient */}
          <LinearGradient id="skinGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#F5E6D3" />
            <Stop offset="50%" stopColor="#E8D5C4" />
            <Stop offset="100%" stopColor="#DBC8B5" />
          </LinearGradient>

          {/* Body shadow gradient */}
          <LinearGradient id="bodyShadow" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#C4B5A5" stopOpacity={0.3} />
            <Stop offset="50%" stopColor="#C4B5A5" stopOpacity={0} />
            <Stop offset="100%" stopColor="#C4B5A5" stopOpacity={0.3} />
          </LinearGradient>

          {/* Joint highlight */}
          <LinearGradient id="jointHighlight" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.4} />
            <Stop offset="100%" stopColor="#D4C4B0" stopOpacity={0.2} />
          </LinearGradient>
        </Defs>

        {/* Static body silhouette layer */}
        <G opacity={0.95}>
          {/* Head */}
          <Path
            d={BODY_SILHOUETTE.head}
            fill="url(#skinGradient)"
            stroke="#D4C4B0"
            strokeWidth={1}
          />

          {/* Neck */}
          <Path
            d={BODY_SILHOUETTE.neck}
            fill="url(#skinGradient)"
            stroke="none"
          />

          {/* Torso */}
          <Path
            d={BODY_SILHOUETTE.torso}
            fill="url(#skinGradient)"
            stroke="#D4C4B0"
            strokeWidth={0.5}
          />

          {/* Pelvis */}
          <Path
            d={BODY_SILHOUETTE.pelvis}
            fill="url(#skinGradient)"
            stroke="#D4C4B0"
            strokeWidth={0.5}
          />

          {/* Arms */}
          <Path
            d={BODY_SILHOUETTE.armLeft}
            fill="none"
            stroke="url(#skinGradient)"
            strokeWidth={28}
            strokeLinecap="round"
          />
          <Path
            d={BODY_SILHOUETTE.armRight}
            fill="none"
            stroke="url(#skinGradient)"
            strokeWidth={28}
            strokeLinecap="round"
          />

          {/* Legs */}
          <Path
            d={BODY_SILHOUETTE.legLeft}
            fill="none"
            stroke="url(#skinGradient)"
            strokeWidth={35}
            strokeLinecap="round"
          />
          <Path
            d={BODY_SILHOUETTE.legRight}
            fill="none"
            stroke="url(#skinGradient)"
            strokeWidth={35}
            strokeLinecap="round"
          />
        </G>

        {/* Anatomical landmarks (bones/tendons) */}
        <G opacity={0.25} strokeWidth={1} stroke="#A89080" fill="none">
          {/* Clavicles */}
          <Path d={LANDMARKS.clavicleLeft} />
          <Path d={LANDMARKS.clavicleRight} />

          {/* Spine (back view only) */}
          {side === "back" && <Path d={LANDMARKS.spine} strokeDasharray="3 3" />}
        </G>

        {/* Joint markers */}
        <G>
          {/* Shoulder joints */}
          <Circle cx={108} cy={166} r={6} fill="url(#jointHighlight)" />
          <Circle cx={252} cy={166} r={6} fill="url(#jointHighlight)" />

          {/* Elbow joints */}
          <Circle cx={58} cy={296} r={5} fill="url(#jointHighlight)" />
          <Circle cx={302} cy={296} r={5} fill="url(#jointHighlight)" />

          {/* Wrist joints */}
          <Circle cx={60} cy={395} r={3} fill="url(#jointHighlight)" />
          <Circle cx={300} cy={395} r={3} fill="url(#jointHighlight)" />

          {/* Knee joints */}
          <Circle cx={140} cy={611} r={5} fill="url(#jointHighlight)" />
          <Circle cx={220} cy={611} r={5} fill="url(#jointHighlight)" />

          {/* Ankle joints */}
          <Circle cx={145} cy={736} r={3} fill="url(#jointHighlight)" />
          <Circle cx={215} cy={736} r={3} fill="url(#jointHighlight)" />
        </G>

        {/* Muscle regions layer */}
        <G>
          {muscles.map((definition) => (
            <MuscleRegion
              key={definition.id}
              definition={definition}
              loadPercent={getLoadPercent(definition.slug)}
              selected={selectedMuscle === definition.slug}
              activation={activation?.[definition.slug]}
              interactive={interactive}
              animateFibers={animateFibers}
              reduceMotion={reduceMotion}
              onPress={() => handleMusclePress(definition.slug)}
            />
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
});
