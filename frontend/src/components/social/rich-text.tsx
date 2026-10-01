import { useState } from "react";
import { Linking, Platform, StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import type { MentionedUser } from "@/src/api";
import { segment } from "@/src/mentions";
import { colors } from "@/src/theme";

/** Hashtags and https links inside a plain run. Same tag rule as the server. */
const TOKEN = /(#[\p{L}\p{N}_]{1,50}|https:\/\/[^\s<>"']{4,500})/u;
const IS_TAG = /^#[\p{L}\p{N}_]{1,50}$/u;
const IS_LINK = /^https:\/\//;

/**
 * Post, comment and message text: mentions open the person, hashtags open the
 * tag's feed, links open in the browser. Everything else is plain text.
 */
function LinkedRun({ children, style, onPress }: { children: string; style: TextStyle; onPress: () => void }) {
  const [hot, setHot] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <Text
      style={[style, hot && styles.hot, pressed && styles.pressed]}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      {...(Platform.OS === "web"
        ? ({
            onMouseEnter: () => setHot(true),
            onMouseLeave: () => {
              setHot(false);
              setPressed(false);
            },
          } as TextProps)
        : {})}
    >
      {children}
    </Text>
  );
}

export function RichText({ content, mentions, style, numberOfLines }: { content: string; mentions?: MentionedUser[]; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const router = useRouter();
  return <Text style={style} numberOfLines={numberOfLines}>
    {segment(content, mentions).map((part, index) => {
      if (part.mention) {
        const person = part.mention;
        return <LinkedRun key={index} style={styles.mention} onPress={() => router.push({ pathname: "/user/[id]", params: { id: person.id } })}>{part.text}</LinkedRun>;
      }
      return part.text.split(TOKEN).map((piece, inner) => {
        if (!piece) return null;
        if (IS_TAG.test(piece)) {
          const tag = piece.slice(1).toLowerCase();
          return <LinkedRun key={`${index}-${inner}`} style={styles.tag} onPress={() => router.push({ pathname: "/tag/[tag]", params: { tag } })}>{piece}</LinkedRun>;
        }
        if (IS_LINK.test(piece)) {
          return <LinkedRun key={`${index}-${inner}`} style={styles.link} onPress={() => void Linking.openURL(piece)}>{piece}</LinkedRun>;
        }
        return <Text key={`${index}-${inner}`}>{piece}</Text>;
      });
    })}
  </Text>;
}

const styles = StyleSheet.create({
  mention: { color: colors.text, fontWeight: "800" },
  tag: { color: colors.text, fontWeight: "700" },
  link: { color: colors.text, textDecorationLine: "underline" },
  hot: { backgroundColor: colors.surface2, textDecorationLine: "underline" },
  pressed: { opacity: 0.72 },
});
