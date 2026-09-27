import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, TICKET_CATEGORIES, type TicketCategory } from "@/src/api";
import { track } from "@/src/analytics";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { BODY_MAX, SUBJECT_MAX, subjectIssue, ticketCategoryLabel } from "./copy";
import { SupportScreen, supportStyles } from "./chrome";

export function SupportTicketForm({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  useFocusEffect(useCallback(() => {
    track("screen_view", { screen: "support/new" });
  }, []));
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [body, setBody] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const issue = subjectIssue(subject);
  const subjectOk = issue === null;
  const bodyOk = body.trim().length <= BODY_MAX;
  const canSubmit = subjectOk && category !== null && bodyOk && !saving;
  const showSubjectError = ((attempted || subject.trim().length > 0) && issue !== null && issue !== "empty")
    || (attempted && issue === "empty");

  const submit = async () => {
    setAttempted(true);
    if (!canSubmit || category === null) return;
    setSaving(true);
    setError("");
    const trimmedBody = body.trim();
    try {
      const created = await api.createTicket({
        subject: subject.trim(),
        category,
        ...(trimmedBody ? { body: trimmedBody } : {}),
      });
      if (!created?.id) {
        setError(t("The server did not return a ticket id."));
        return;
      }
      onCreated(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not send your ticket"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SupportScreen title={t("NEW TICKET")} onBack={onBack} testID="support-form">
      <ScrollView contentContainerStyle={supportStyles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={supportStyles.label}>{t("SUBJECT")}</Text>
        <TextInput
          value={subject}
          onChangeText={setSubject}
          maxLength={SUBJECT_MAX}
          placeholder={t("Short summary")}
          placeholderTextColor={colors.textDim}
          style={supportStyles.input}
          testID="support-subject"
          accessibilityLabel={t("SUBJECT")}
        />
        {showSubjectError ? (
          <Text accessibilityRole="alert" testID="support-subject-error" style={supportStyles.hint}>
            {t(issue === "long" ? "Subject is too long." : "Enter a subject.")}
          </Text>
        ) : null}

        <Text style={supportStyles.label}>{t("CATEGORY")}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {TICKET_CATEGORIES.map(item => {
            const selected = category === item;
            return (
              <Pressable
                key={item}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                testID={`support-category-${item}`}
                onPress={() => setCategory(item)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.sm,
                  borderWidth: 1,
                  borderColor: selected ? colors.brand : colors.border,
                  backgroundColor: selected ? colors.brand : colors.surface2,
                }}
              >
                <Text style={{ color: selected ? colors.brandOn : colors.textMuted, fontSize: 12, fontWeight: "800" }}>
                  {ticketCategoryLabel(item, t)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {attempted && category === null ? (
          <Text accessibilityRole="alert" testID="support-category-error" style={supportStyles.hint}>{t("Choose a category.")}</Text>
        ) : null}
        {!attempted && subjectOk && category === null ? (
          <Text style={supportStyles.hint}>{t("Choose a category.")}</Text>
        ) : null}

        <Text style={supportStyles.label}>{t("MESSAGE")}</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          maxLength={BODY_MAX}
          multiline
          placeholder={t("What happened? (optional)")}
          placeholderTextColor={colors.textDim}
          style={[supportStyles.input, supportStyles.multiline]}
          testID="support-body"
          accessibilityLabel={t("MESSAGE")}
        />
        {!bodyOk ? (
          <Text accessibilityRole="alert" testID="support-body-error" style={supportStyles.hint}>{t("Message is too long.")}</Text>
        ) : null}

        {error ? <Text accessibilityRole="alert" testID="support-form-error" style={supportStyles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          testID="support-submit"
          disabled={!canSubmit}
          onPress={() => void submit()}
          style={[supportStyles.submit, !canSubmit && supportStyles.disabled]}
        >
          <Text style={supportStyles.submitText}>{t(saving ? "SENDING…" : "SEND TICKET")}</Text>
        </Pressable>
      </ScrollView>
    </SupportScreen>
  );
}
