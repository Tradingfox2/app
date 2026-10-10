import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { CoachMark } from "@/src/components/night/coach-mark";
import { leaveOrHome } from "@/src/leave-home";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

type Role = "user" | "assistant";
type Turn = { role: Role; content: string };

function speaker(role: Role, label: (source: string) => string): string {
  switch (role) {
    case "user":
      return label("Me");
    case "assistant":
      return label("Coach");
    default: {
      const unexpected: never = role;
      return unexpected;
    }
  }
}

export default function CoachChat() {
  const { t } = useI18n();
  const scroller = useRef<ScrollView>(null);
  const dirty = useRef(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api.coachHistory().then((rows) => {
      if (live && !dirty.current) setTurns(rows);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  useEffect(() => { scroller.current?.scrollToEnd({ animated: true }); }, [turns.length]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    dirty.current = true;
    setSending(true);
    setError("");
    try {
      const reply = await api.coachChat(message);
      setTurns((prev) => [...prev, { role: "user", content: message }, { role: "assistant", content: reply }]);
      setDraft("");
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      setError(status === 429
        ? t("You have reached today's coach messages.")
        : status === 503
          ? t("The coach is offline. Try again shortly.")
          : t("Could not send"));
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Back")} onPress={leaveOrHome} style={styles.icon}>
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </Pressable>
          <CoachMark size={36} />
          <Text style={styles.headerTitle}>{t("COACH")}</Text>
        </View>
        <Text style={styles.caption}>{t("Training guidance, not a diagnosis.")}</Text>
        <ScrollView ref={scroller} contentContainerStyle={styles.thread} keyboardShouldPersistTaps="handled" testID="coach-chat-thread">
          {turns.length === 0 ? <Text style={styles.empty}>{t("Ask about training, recovery, or your labs.")}</Text> : turns.map((turn, index) => (
            <View key={`${index}-${turn.role}`} style={[styles.bubble, turn.role === "user" ? styles.mine : styles.theirs]}>
              <Text style={styles.who}>{speaker(turn.role, t)}</Text>
              <Text style={styles.body}>{turn.content}</Text>
            </View>
          ))}
        </ScrollView>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.composer}>
          <TextInput value={draft} onChangeText={setDraft} placeholder={t("Message the coach")} placeholderTextColor={colors.textDim} style={styles.input} multiline testID="coach-chat-input" />
          <Pressable accessibilityRole="button" accessibilityLabel={t("SEND")} disabled={sending || !draft.trim()} onPress={() => void send()} style={[styles.send, (sending || !draft.trim()) && styles.disabled]} testID="coach-chat-send">
            <Text style={styles.sendTxt}>{t(sending ? "SENDING..." : "SEND")}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.section, color: colors.text },
  thread: { padding: spacing.lg, gap: spacing.md },
  empty: { ...type.caption, color: colors.textMuted },
  bubble: { maxWidth: "85%", borderRadius: radius.md, padding: spacing.md },
  mine: { alignSelf: "flex-end", backgroundColor: colors.surface2 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  who: { ...type.eyebrow, marginBottom: spacing.xs },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  caption: { ...type.caption, color: colors.textMuted, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  error: { color: colors.errorText, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, backgroundColor: colors.surface2, color: colors.text, padding: spacing.md },
  send: { minHeight: 48, paddingHorizontal: spacing.md, backgroundColor: colors.brand, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  sendTxt: { ...type.button },
  disabled: { opacity: 0.45 },
});
