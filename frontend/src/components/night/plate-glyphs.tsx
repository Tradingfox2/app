import Svg, { Circle, Path, Rect } from "react-native-svg";
import { colors } from "@/src/theme";

const stroke = {
  fill: "none" as const,
  stroke: colors.text,
  strokeWidth: 2.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type KnownEquipment = "barbell" | "dumbbell" | "kettlebell" | "machine" | "bodyweight";

function knownEquipment(value: string | null | undefined): KnownEquipment | null {
  switch (value) {
    case "barbell":
    case "dumbbell":
    case "kettlebell":
    case "machine":
    case "bodyweight":
      return value;
    default:
      return null;
  }
}

function Glyph({ kind, size }: { kind: KnownEquipment; size: number }) {
  switch (kind) {
    case "barbell":
      return (
        <Svg width={size} height={size} viewBox="0 0 64 64" testID="equipment-glyph-barbell">
          <Rect x="6" y="20" width="6" height="24" rx="1.5" {...stroke} />
          <Rect x="13" y="24" width="4" height="16" rx="1" {...stroke} />
          <Path d="M17 32h30" {...stroke} />
          <Rect x="47" y="24" width="4" height="16" rx="1" {...stroke} />
          <Rect x="52" y="20" width="6" height="24" rx="1.5" {...stroke} />
        </Svg>
      );
    case "dumbbell":
      return (
        <Svg width={size} height={size} viewBox="0 0 64 64" testID="equipment-glyph-dumbbell">
          <Rect x="8" y="24" width="12" height="16" rx="2" {...stroke} />
          <Path d="M20 32h24" {...stroke} />
          <Rect x="44" y="24" width="12" height="16" rx="2" {...stroke} />
        </Svg>
      );
    case "kettlebell":
      return (
        <Svg width={size} height={size} viewBox="0 0 64 64" testID="equipment-glyph-kettlebell">
          <Path d="M24 28v-4a8 8 0 0 1 16 0v4" {...stroke} />
          <Circle cx="32" cy="40" r="13" {...stroke} />
        </Svg>
      );
    case "machine":
      return (
        <Svg width={size} height={size} viewBox="0 0 64 64" testID="equipment-glyph-machine">
          <Path d="M16 12h14v40H16a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2z" {...stroke} />
          <Path d="M18 24h8M18 32h8M18 40h8" {...stroke} />
          <Path d="M30 18h12a8 8 0 0 1 0 16H36" {...stroke} />
          <Path d="M36 30h8" {...stroke} />
        </Svg>
      );
    case "bodyweight":
      return (
        <Svg width={size} height={size} viewBox="0 0 64 64" testID="equipment-glyph-bodyweight">
          <Circle cx="16" cy="18" r="4" {...stroke} />
          <Path d="M18 22l12 8 22 2" {...stroke} />
          <Path d="M30 30l-8 16" {...stroke} />
          <Path d="M52 32l6 14" {...stroke} />
        </Svg>
      );
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** A rounded plate. Unknown equipment must not borrow the barbell. */
function NeutralPlate({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" testID="equipment-glyph-plate">
      <Rect x="18" y="14" width="28" height="36" rx="8" {...stroke} />
    </Svg>
  );
}

export function EquipmentGlyph({ equipment, size = 48 }: { equipment?: string | null; size?: number }) {
  const kind = knownEquipment(equipment);
  if (!kind) return <NeutralPlate size={size} />;
  return <Glyph kind={kind} size={size} />;
}

/** Two uprights and a bar. Chartreuse stays off the artwork. */
export function IronflowMark({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" testID="ironflow-mark">
      <Rect x="8" y="18" width="8" height="28" rx="2" {...stroke} />
      <Path d="M16 32h32" {...stroke} />
      <Rect x="48" y="18" width="8" height="28" rx="2" {...stroke} />
    </Svg>
  );
}
