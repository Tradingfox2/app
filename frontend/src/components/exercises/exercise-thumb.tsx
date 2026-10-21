import { memo, useMemo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";
import { ExerciseThumbMap } from "./exercise-thumb-map";

type Props = {
  /** Exercise slug. */
  slug?: string | null;
  equipment?: string | null;
  /** Program day focus (push, pull, legs, ...). Takes precedence over slug. */
  dayFocus?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Small illustrated thumbnail: posed figure, equipment and highlighted working muscles. */
function ExerciseThumbBase({ slug, equipment, dayFocus, size = 40, style, testID }: Props) {
  const xml = useMemo(() => {
    const key = dayFocus != null
      ? ExerciseThumbMap.keyForDay(dayFocus)
      : ExerciseThumbMap.keyForExercise(slug, equipment);
    return ExerciseThumbMap.xml(key);
  }, [slug, equipment, dayFocus]);
  return (
    <View
      style={[{ width: size, height: size, borderRadius: size * 0.18, overflow: "hidden" }, style]}
      testID={testID ?? (slug ? `exercise-thumb-${slug}` : undefined)}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
}

export const ExerciseThumb = memo(ExerciseThumbBase);
