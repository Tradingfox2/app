import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "@/src/theme";

/**
 * Single-effort ring. The track is the border token; the arc is the caller's
 * color (Strain orange on the activity day). Chartreuse is not a ring color.
 */
export function ActivityRing({
  size,
  stroke,
  progress,
  color,
  marker = false,
}: {
  size: number;
  stroke: number;
  progress: number;
  color: string;
  /** Center dot when a day has a session but no logged duration. */
  marker?: boolean;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, progress));
  const offset = circumference * (1 - pct);
  const showMarker = marker && pct <= 0;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={stroke}
          fill="none"
        />
        {pct > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
        {showMarker ? (
          <Circle cx={size / 2} cy={size / 2} r={Math.max(2, stroke / 2)} fill={color} />
        ) : null}
      </Svg>
    </View>
  );
}
