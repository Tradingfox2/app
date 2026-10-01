import Svg, { Polyline } from "react-native-svg";
import { routeSketch, type Fix } from "@/src/recorder-math";
import { colors } from "@/src/theme";

/** Measured segments only. A gap is a separate line, never a bridge. */
export function RouteSketch({
  segments,
  testID,
}: {
  segments: readonly (readonly Fix[])[];
  testID?: string;
}) {
  const lines = routeSketch(segments);
  if (lines.length === 0) return null;
  return (
    <Svg width="100%" height={180} viewBox="0 0 320 180" testID={testID}>
      {lines.map((line, index) => (
        <Polyline
          key={index}
          points={line.map((point) => `${point.x},${point.y}`).join(" ")}
          stroke={colors.text}
          strokeWidth={3}
          fill="none"
        />
      ))}
    </Svg>
  );
}
