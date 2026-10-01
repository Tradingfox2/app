import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { useFocusEffect } from "expo-router";
import { api, type Ticket, type TicketMessage } from "@/src/api";
import { track } from "@/src/analytics";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { BODY_MAX, ticketAuthorText, ticketCategoryText, ticketStatusText } from "./copy";
import { SupportScreen, supportStyles } from "./chrome";

export function SupportTicketDetail({
  ticketId,
  onBack,
}: {
  ticketId: string;
  onBack: () => void;
}) {
  const { t, formatDate } = useI18n();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replySent, setReplySent] = useState(false);
  const revision = useRef(0);

  const load = useCallback(async () => {
    if (!ticketId) {
      setLoading(false);
      setError(t("Could not load this ticket"));
      return;
    }
    const current = ++revision.current;
    try {
      const data = await api.ticket(ticketId);
      if (current !== revision.current) return;
      if (!data?.id) {
        setError(t("Could not load this ticket"));
        return;
      }
      const incoming = Array.isArray(data.messages) ? data.messages.filter(message => message.id) : [];
      setTicket(data);
      setMessages(previous => {
        const extras = previous.filter(message => message.ticket_id === data.id && !incoming.some(row => row.id === message.id));
        return [...incoming, ...extras];
      });
      setError("");
    } catch (cause) {
      if (current !== revision.current) return;
      setError(cause instanceof Error ? cause.message : t("Could not load this ticket"));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [t, ticketId]);

  useFocusEffect(useCallback(() => {
    track("screen_view", { screen: "support/[id]" });
  }, []));
  useFocusEffect(useCallback(() => {
    setLoading(true);
    void load();
    return () => { revision.current += 1; };
  }, [load]));

  const closed = ticket?.status === "closed";
  const send = async () => {
    const body = draft.trim();
    if (!body || body.length > BODY_MAX || sending || !ticketId || closed) return;
    setSending(true);
    setReplyError("");
    setReplySent(false);
    try {
      const message = await api.addTicketMessage(ticketId, { body });
      if (!message?.id) {
        setReplyError(t("The server did not return a message."));
        return;
      }
      setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message]);
      setDraft("");
      setReplySent(true);
      track("ticket_replied", { ticket_id: ticketId });
    } catch (cause) {
      setReplyError(cause instanceof Error ? cause.message : t("Could not send your reply"));
    } finally {
      setSending(false);
    }
  };

  const canSend = draft.trim().length > 0 && draft.trim().length <= BODY_MAX && !sending;
  const subtitle = ticket ? `${ticketStatusText(ticket.status, t)} · ${ticketCategoryText(ticket.category, t)}` : undefined;

  return (
    <SupportScreen
      kicker={t("SUPPORT")}
      title={ticket?.subject || t("SUPPORT")}
      subtitle={subtitle}
      subtitleTestID="support-status"
      onBack={onBack}
      testID="support-detail"
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {error ? (
          <View accessibilityRole="alert" style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
            <Text testID="support-detail-error" style={supportStyles.error}>{error}</Text>
            <Affordance accessibilityRole="button" testID="support-detail-retry" onPress={() => { setLoading(true); setError(""); void load(); }}>
              <Text style={supportStyles.retry}>{t("Retry")}</Text>
            </Affordance>
          </View>
        ) : null}
        {loading && !ticket ? <ActivityIndicator testID="support-detail-loading" accessibilityLabel={t("Loading...")} color={colors.text} style={{ marginTop: spacing.lg }} /> : null}
        <ScrollView contentContainerStyle={supportStyles.scroll} keyboardShouldPersistTaps="handled">
          {ticket && messages.length === 0 && !loading ? (
            <Text testID="support-thread-empty" style={supportStyles.emptyText}>{t("No replies yet.")}</Text>
          ) : null}
          {messages.map(message => (
            <View
              key={message.id}
              testID={`support-message-${message.id}`}
              style={{
                marginBottom: spacing.sm,
                padding: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: message.author_role === "staff" ? colors.text : colors.border,
                backgroundColor: colors.surface,
              }}
            >
              <Text style={{ color: message.author_role === "staff" ? colors.text : colors.textMuted, fontSize: 11, fontWeight: "800" }}>
                {ticketAuthorText(message.author_role, t)}
              </Text>
              <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 4 }}>{message.body}</Text>
              {message.media_id ? <Text style={supportStyles.hint}>{t("This reply includes an attachment.")}</Text> : null}
              <Text style={{ color: colors.textDim, fontSize: 11, marginTop: spacing.sm }}>
                {formatDate(message.created_at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </Text>
            </View>
          ))}
        </ScrollView>
        {ticket && closed ? (
          <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text testID="support-closed" style={supportStyles.hint}>{t("Ticket is closed")}</Text>
          </View>
        ) : null}
        {ticket && !closed ? (
          <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm }}>
            <TextInput
              value={draft}
              onChangeText={value => { setDraft(value); setReplySent(false); }}
              maxLength={BODY_MAX}
              multiline
              placeholder={t("Write a follow-up")}
              placeholderTextColor={colors.textDim}
              style={[supportStyles.input, { minHeight: 72 }]}
              testID="support-reply"
              accessibilityLabel={t("Write a follow-up")}
              editable={!sending}
            />
            {draft.trim().length > BODY_MAX ? (
              <Text accessibilityRole="alert" style={supportStyles.hint}>{t("Message is too long.")}</Text>
            ) : null}
            {replyError ? <Text accessibilityRole="alert" testID="support-reply-error" style={supportStyles.error}>{replyError}</Text> : null}
            {replySent ? <Text testID="support-reply-success" style={supportStyles.success}>{t("Reply sent.")}</Text> : null}
            <Affordance signal="brand"
              accessibilityRole="button"
              testID="support-reply-submit"
              disabled={!canSend}
              onPress={() => void send()}
              style={[supportStyles.submit, { marginTop: 0 }, !canSend && supportStyles.disabled]}
            >
              <Text style={supportStyles.submitText}>{t(sending ? "SENDING…" : "SEND REPLY")}</Text>
            </Affordance>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SupportScreen>
  );
}
