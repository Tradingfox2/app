import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View, StyleSheet } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import type { MuscleSlug, BodySide, ActivationMap } from "./muscle-types";
import {
  FRONT_VIEWBOX,
  BACK_VIEWBOX,
  BODY_OUTLINE,
  STRUCTURAL_FRONT,
  STRUCTURAL_BACK,
  FRONT_MUSCLES,
  BACK_MUSCLES,
  type MusclePathDefinition,
} from "./anatomy-artwork";
import { MuscleRegion } from "./muscle-region";
import { colors } from "../../theme";

export type AnatomyBodyProps = {
  side: BodySide;
  volumes: Partial<Record<MuscleSlug, number>>;
  max: number;
  selectedMuscle?: MuscleSlug | null;
  activation?: ActivationMap;
  interactive?: boolean;
  animateFibers?: boolean;
  reduceMotion?: boolean;
  onMusclePress?: (muscle: MuscleSlug, side: BodySide) => void;
  width?: number;
  height?: number;
  /** Overrides the side's viewBox so a callout gutter can share the same scale. */
  viewBox?: string;
};

function resolveSvgNode(ref: unknown): SVGSVGElement | null {
  if (!ref || typeof ref !== "object") return null;
  const asEl = ref as SVGSVGElement;
  if (typeof asEl.addEventListener === "function" && asEl.tagName?.toLowerCase() === "svg") {
    return asEl;
  }
  const inner = (ref as { elementRef?: { current?: SVGSVGElement | null } })
    .elementRef?.current;
  if (inner && typeof inner.addEventListener === "function") return inner;
  return null;
}

function slugFromDomEvent(
  event: Event,
  svg: SVGSVGElement,
  idToSlug: Map<string, MuscleSlug>,
): MuscleSlug | null {
  let node = event.target as Element | null;
  while (node && node !== svg) {
    if (node.id && idToSlug.has(node.id)) return idToSlug.get(node.id)!;
    const data = node.getAttribute?.("data-muscle-slug");
    if (data) return data as MuscleSlug;
    node = node.parentElement;
  }

  const mouse = event as MouseEvent;
  if (typeof mouse.clientX !== "number") return null;
  const point = svg.createSVGPoint();
  point.x = mouse.clientX;
  point.y = mouse.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const local = point.matrixTransform(ctm.inverse());

  const paths = svg.querySelectorAll("path[id]");
  for (let i = paths.length - 1; i >= 0; i -= 1) {
    const path = paths[i] as SVGPathElement;
    const slug = idToSlug.get(path.id);
    if (!slug || typeof path.isPointInFill !== "function") continue;
    try {
      if (path.isPointInFill(local)) return slug;
    } catch {
      // Some browsers throw if the path is not rendered yet.
    }
  }
  return null;
}

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
  width = 280,
  height = 560,
  viewBox,
}: AnatomyBodyProps) {
  const muscles = useMemo<MusclePathDefinition[]>(
    () => (side === "front" ? FRONT_MUSCLES : BACK_MUSCLES),
    [side],
  );
  const structural = side === "front" ? STRUCTURAL_FRONT : STRUCTURAL_BACK;
  const svgRef = useRef<unknown>(null);
  const [svgNode, setSvgNode] = useState<SVGSVGElement | null>(null);
  const [glow, setGlow] = useState(1);
  const [sweep, setSweep] = useState(0);

  useEffect(() => {
    if (reduceMotion || !selectedMuscle) {
      setGlow(1);
      setSweep(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      const progress = Math.min((Date.now() - startedAt) / 560, 1);
      setGlow(0.65 + 0.35 * Math.sin(progress * Math.PI));
      setSweep(progress);
      if (progress === 1) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [reduceMotion, selectedMuscle]);

  const setSvgRef = useCallback((node: unknown) => {
    svgRef.current = node;
    setSvgNode(resolveSvgNode(node));
  }, []);

  const getLoadPercent = useCallback(
    (slug: MuscleSlug): number => {
      const volume = volumes?.[slug] ?? 0;
      if (max <= 0 || volume <= 0) return 0;
      return Math.round((volume / max) * 100);
    },
    [volumes, max],
  );

  const idToSlug = useMemo(() => {
    const map = new Map<string, MuscleSlug>();
    for (const definition of muscles) {
      map.set(definition.id, definition.slug);
    }
    return map;
  }, [muscles]);

  const handleMusclePress = useCallback(
    (slug: MuscleSlug) => {
      if (interactive && onMusclePress) onMusclePress(slug, side);
    },
    [interactive, onMusclePress, side],
  );

  // On web the listener lives on the wrapping <div>, not on the <svg>: the
  // react-native-svg ref sometimes resolves after the first paint, and a
  // container listener also catches taps that land on the svg while it is
  // yawing in 3D. The svg itself is looked up lazily from the container.
  const containerRef = useRef<View | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || !interactive) return;
    const container = containerRef.current as unknown as HTMLElement | null;
    if (!container || typeof container.addEventListener !== "function") return;

    // role is applied on the DOM node. Passing it as accessibilityRole makes
    // react-native-web swap the path for an HTML button.
    for (const node of container.querySelectorAll("path[id]")) {
      if (!idToSlug.has(node.id)) continue;
      node.setAttribute("role", "button");
    }

    const onClick = (event: Event) => {
      const svg =
        svgNode ??
        (container.querySelector("svg") as SVGSVGElement | null);
      if (!svg) return;
      const slug = slugFromDomEvent(event, svg, idToSlug);
      if (slug) {
        event.preventDefault();
        event.stopPropagation();
        handleMusclePress(slug);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const svg =
        svgNode ??
        (container.querySelector("svg") as SVGSVGElement | null);
      if (!svg) return;
      const target = event.target as Element | null;
      if (!target || !container.contains(target)) return;
      if (event.key === "Enter" || event.key === " ") {
        const slug = slugFromDomEvent(event, svg, idToSlug);
        if (!slug) return;
        event.preventDefault();
        handleMusclePress(slug);
        return;
      }
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight"
      ) {
        return;
      }
      const paths = [...svg.querySelectorAll("path[id]")].filter((path) => idToSlug.has(path.id));
      const index = paths.findIndex(
        (path) => path === document.activeElement || path.contains(document.activeElement),
      );
      if (index < 0) return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
      const next = paths[(index + delta + paths.length) % paths.length] as HTMLElement | undefined;
      next?.focus();
    };

    container.addEventListener("click", onClick);
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("click", onClick);
      container.removeEventListener("keydown", onKeyDown);
    };
  }, [handleMusclePress, idToSlug, interactive, svgNode]);

  return (
    <View
      ref={containerRef}
      testID={`anatomy-body-${side}`}
      style={[
        styles.container,
        { width, height },
        Platform.OS === "web" && interactive
          ? { cursor: "pointer" as const }
          : null,
      ]}
    >
      <Svg
        ref={setSvgRef as never}
        width={width}
        height={height}
        viewBox={viewBox ?? (side === "front" ? FRONT_VIEWBOX : BACK_VIEWBOX)}
        preserveAspectRatio="xMidYMid meet"
      >
        <G pointerEvents="none">
          {structural.map((part) => (
            <Path
              key={part.id}
              d={part.path}
              fill="#1E293B"
              stroke="none"
            />
          ))}
        </G>

        <G>
          {muscles.map((definition) => (
            <MuscleRegion
              key={definition.id}
              definition={definition}
              loadPercent={getLoadPercent(definition.slug)}
              selected={selectedMuscle === definition.slug}
              activation={activation?.[definition.slug]}
              interactive={interactive && Platform.OS !== "web"}
              focusable={interactive && Platform.OS === "web"}
              animateFibers={animateFibers && !activation?.[definition.slug]}
              reduceMotion={reduceMotion}
              glow={glow}
              sweep={selectedMuscle === definition.slug ? sweep : 0}
              onPress={() => handleMusclePress(definition.slug)}
            />
          ))}
        </G>

        <Path
          d={BODY_OUTLINE[side]}
          fill="none"
          stroke={colors.borderStrong}
          strokeWidth={1.4}
          strokeOpacity={0.85}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
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
