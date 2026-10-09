import { useRef, useState, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { colors, radius } from "@/src/theme";

type Props = {
  /** Plain-language meaning of the number. Already translated. */
  glossary: string;
  value?: string;
  label?: string;
  children?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  valueStyle?: StyleProp<TextStyle>;
  labelStyle?: StyleProp<TextStyle>;
  /**
   * `overlay` draws the sentence over the page so opening it does not
   * reflow the list underneath. Inline is the staff console's layout.
   */
  placement?: "inline" | "overlay";
};

/**
 * A count chip with a glossary.
 * Hover, long-press, or a tap shows the sentence. The accessible name
 * includes it as well. The number itself is whatever the caller passed.
 */
export function MetricGlossary({
  glossary,
  value,
  label,
  children,
  testID,
  style,
  valueStyle,
  labelStyle,
  placement = "inline",
}: Props) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const fromLongPress = useRef(false);
  const open = pinned || hovered;
  const togglePinned = () => setPinned(current => !current);
  const named = label != null && value != null ? `${label}, ${value}. ${glossary}` : undefined;
  const a11y: PressableProps = {
    accessibilityRole: "button",
    accessibilityHint: glossary,
    accessibilityState: { expanded: open },
    ...(named ? { accessibilityLabel: named } : {}),
  };

  return (
    <Pressable
      {...a11y}
      testID={testID}
      style={[style, placement === "overlay" ? styles.overlayHost : null]}
      delayLongPress={350}
      onHoverIn={Platform.OS === "web" ? () => setHovered(true) : undefined}
      onHoverOut={Platform.OS === "web" ? () => setHovered(false) : undefined}
      onLongPress={() => {
        fromLongPress.current = true;
        togglePinned();
      }}
      onPress={() => {
        if (fromLongPress.current) {
          fromLongPress.current = false;
          return;
        }
        togglePinned();
      }}
    >
      {children ?? (
        <>
          {value != null ? <Text style={valueStyle}>{value}</Text> : null}
          {label != null ? <Text style={labelStyle}>{label}</Text> : null}
        </>
      )}
      {open ? (
        <Text
          accessibilityLiveRegion="polite"
          style={placement === "overlay" ? styles.glossaryOverlay : styles.glossary}
          testID={testID ? `${testID}-glossary` : undefined}
        >
          {glossary}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glossary: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  overlayHost: { position: "relative", overflow: "visible", zIndex: 2 },
  glossaryOverlay: {
    position: "absolute",
    zIndex: 3,
    left: 0,
    top: "100%",
    width: 260,
    marginTop: 4,
    padding: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
});
