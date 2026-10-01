import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { colors } from "@/src/theme";

export type LineValue = number | null;

export function chartGeometry(values: readonly LineValue[], width = 320, height = 160, pad = 24) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 0;
  const range = Math.max(1, max - min);
  const stepX = values.length <= 1 ? 0 : (width - pad * 2) / (values.length - 1);
  const points = values.map((value, index) => {
    const x = pad + index * stepX;
    if (value === null || !Number.isFinite(value)) return { x, y: null as number | null };
    return { x, y: height - pad - ((value - min) / range) * (height - pad * 2) };
  });
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push({ x: point.x, y: point.y });
  }
  if (run.length) runs.push(run);
  return { width, height, pad, min, max, points, runs };
}

export function LineChart({
  values,
  color = colors.text,
  testID,
}: {
  values: readonly LineValue[];
  color?: string;
  testID?: string;
}) {
  const chart = chartGeometry(values);
  const dots = chart.points.filter((point): point is { x: number; y: number } => point.y !== null);
  if (dots.length === 0) return null;
  return (
    <Svg width="100%" height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} testID={testID}>
      <Line x1={chart.pad} y1={chart.height - chart.pad} x2={chart.width - chart.pad} y2={chart.height - chart.pad} stroke={colors.border} strokeWidth={1} />
      {chart.runs.filter((run) => run.length > 1).map((run, index) => (
        <Polyline key={index} points={run.map((point) => `${point.x},${point.y}`).join(" ")} stroke={color} strokeWidth={3} fill="none" />
      ))}
      {dots.map((point, index) => (
        <Circle key={index} cx={point.x} cy={point.y} r={4} fill={color} stroke={colors.bg} strokeWidth={2} />
      ))}
    </Svg>
  );
}
