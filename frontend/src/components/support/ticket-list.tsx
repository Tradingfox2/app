import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, TICKET_LIST_LIMIT, type TicketSummary } from "@/src/api";
import { track } from "@/src/analytics";
import { card, colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { statusTone, ticketCategoryText, ticketStatusText } from "./copy";
import { SupportScreen, supportStyles } from "./chrome";

export function SupportTicketList({
  onBack,
  onOpen,
  onCreate,
}: {
  onBack: () => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { t, formatDate } = useI18n();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);

  const load = useCallback(async () => {
    const current = ++revision.current;
    try {
      const data = await api.tickets({ limit: TICKET_LIST_LIMIT });
      if (current !== revision.current) return;
      if (!Array.isArray(data)) {
        setError(t("Could not load tickets"));
        return;
      }
      setTickets(data);
      setError("");
    } catch (cause) {
      if (current !== revision.current) return;
      setError(cause instanceof Error ? cause.message : t("Could not load tickets"));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [t]);

  useFocusEffect(useCallback(() => {
    track("screen_view", { screen: "support" });
  }, []));
  useFocusEffect(useCallback(() => {
    setLoading(true);
    setError("");
    void load();
    return () => { revision.current += 1; };
  }, [load]));

  return (
    <SupportScreen
      title={t("SUPPORT")}
      onBack={onBack}
      testID="support-list"
      headerRight={(
        <Affordance
          accessibilityRole="button"
          accessibilityLabel={t("NEW TICKET")}
          testID="support-new"
          onPress={onCreate}
          style={styles.icon}
        >
          <Ionicons name="add" size={24} color={colors.text} />
        </Affordance>
      )}
    >
      {error ? (
        <View accessibilityRole="alert" style={styles.alert}>
          <Text testID="support-error" style={supportStyles.error}>{error}</Text>
          <Affordance accessibilityRole="button" testID="support-retry" onPress={() => { setLoading(true); setError(""); void load(); }}>
            <Text style={supportStyles.retry}>{t("Retry")}</Text>
          </Affordance>
        </View>
      ) : null}
      {loading ? <ActivityIndicator testID="support-loading" accessibilityLabel={t("Loading...")} color={colors.text} style={styles.spinner} /> : null}
      <FlatList
        style={{ flex: 1 }}
        data={tickets ?? []}
        keyExtractor={item => item.id}
        contentContainerStyle={supportStyles.scroll}
        ListEmptyComponent={!loading && !error ? (
          <View style={supportStyles.empty}>
            <Ionicons name="chatbubbles-outline" size={36} color={colors.textDim} />
            <Text testID="support-empty" style={supportStyles.emptyTitle}>{t("No tickets yet.")}</Text>
            <Text style={supportStyles.emptyText}>{t("Open a ticket and the team will reply here.")}</Text>
            <Affordance signal="brand" accessibilityRole="button" testID="support-empty-create" onPress={onCreate} style={supportStyles.submit}>
              <Text style={supportStyles.submitText}>{t("NEW TICKET")}</Text>
            </Affordance>
          </View>
        ) : null}
        renderItem={({ item }) => (
          <Affordance
            accessibilityRole="button"
            testID={`ticket-${item.id}`}
            onPress={() => onOpen(item.id)}
            style={styles.card}
          >
            <View style={styles.cardTop}>
              <Text style={styles.subject}>{item.subject}</Text>
              <StatusPill status={item.status} />
            </View>
            <Text style={styles.meta}>
              {ticketCategoryText(item.category, t)}
              {" · "}
              {formatDate(item.updated_at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </Text>
          </Affordance>
        )}
      />
    </SupportScreen>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = statusTone(status);
  const color = tone === "warning" ? colors.warning : tone === "muted" ? colors.textMuted : colors.text;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{ticketStatusText(status, t)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  spinner: { marginTop: spacing.md },
  alert: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  card: { ...card, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm, gap: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  subject: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 12 },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
});
