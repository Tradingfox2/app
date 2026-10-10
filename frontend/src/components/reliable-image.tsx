import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ImageStyle } from "react-native";
import { Image, type ImageProps } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";

/** Cached image with a local placeholder when the remote file fails. */
export function ReliableImage({ style, onError, accessibilityLabel, ...rest }: ImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[styles.fallback, style as StyleProp<ImageStyle>]} accessibilityLabel={accessibilityLabel}>
        <Ionicons name="image-outline" size={18} color={colors.textMuted} />
      </View>
    );
  }
  return (
    <Image
      {...rest}
      accessibilityLabel={accessibilityLabel}
      style={style}
      cachePolicy="memory-disk"
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
});
