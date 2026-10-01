import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { api, type MentionedUser } from "@/src/api";
import { activeQuery, applyMention } from "@/src/mentions";
import { colors, radius, spacing } from "@/src/theme";
import { Avatar } from "./avatar";

/**
 * A text box that turns `@na…` into a people picker and writes the `<@id>`
 * token the server understands. Suggestions come from people search, so a
 * post or comment can mention anyone the member can find.
 */
export function MentionInput({ value, onChangeText, style, testID, ...props }: Omit<TextInputProps, "style"> & { value: string; onChangeText: (next: string) => void; style?: StyleProp<TextStyle> }) {
  const [suggestions, setSuggestions] = useState<MentionedUser[]>([]);
  const query = activeQuery(value);
  const latest = useRef(0);

  useEffect(() => {
    if (query === null || query.length < 2) { setSuggestions([]); return; }
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      api.searchUsers(query)
        .then(result => { if (ticket === latest.current) setSuggestions(result.results.slice(0, 5)); })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return <View>
    {suggestions.length && query !== null ? <View style={styles.list} testID={testID ? `${testID}-suggestions` : undefined}>
      {suggestions.map(person => <Affordance key={person.id} accessibilityRole="button" onPress={() => { onChangeText(applyMention(value, person)); setSuggestions([]); }} style={styles.row} testID={`mention-suggestion-${person.id}`}>
        <Avatar user={person} size={24} /><Text style={styles.name}>{person.full_name || "?"}</Text>
      </Affordance>)}
    </View> : null}
    <TextInput {...props} testID={testID} value={value} onChangeText={onChangeText} style={style} />
  </View>;
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface2, marginBottom: spacing.xs },
  row: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  name: { color: colors.text, fontWeight: "700" },
});
