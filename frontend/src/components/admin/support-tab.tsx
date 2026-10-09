import { useEffect, useRef } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Affordance } from "@/src/press-affordance";
import type { SupportMessage, SupportTicketStatus } from "@/src/api";
import { colors } from "@/src/theme";
import { selectedControl } from "@/src/community-copy";
import { staffTicketStatusLabel } from "@/src/components/support/copy";
import { queueAge } from "./queue-age";
import { consoleStyles as styles } from "./console-styles";
import { DetailPanel } from "./detail-panel";
import { FilterBar } from "./filter-bar";
import { QueueList } from "./queue-list";
import type { AdminConsoleModel } from "./use-admin-console";

const TICKET_STATUSES: SupportTicketStatus[] = ["open", "pending", "closed"];

function ticketLabel(person: { full_name: string | null; email: string | null } | null | undefined, fallback: string): string {
  return person?.full_name || person?.email || fallback;
}

function focusTestId(testId: string) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus());
}

export function SupportTab({ model }: { model: AdminConsoleModel }) {
  const {
    t, formatDate, can, ticketStatus, setTicketStatus, unassignedOnly, setUnassignedOnly,
    ticketQuery, onTicketQuery, submitTicketSearch, tickets, ticketDetail, setTicketDetail,
    draftStatus, setDraftStatus, reply, setReply, ticketTotal, ticketCursor, sectionErrors,
    updatedAt, working, moreTickets, openTicket, saveTicketStatus, sendReply, retrySection,
  } = model;
  const visibleTickets = (tickets ?? []).filter(ticket => !unassignedOnly || ticket.assignee_id == null);
  const detailId = ticketDetail?.id ?? null;
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    if (detailId) {
      lastId.current = detailId;
      focusTestId("ticket-back");
      return;
    }
    if (lastId.current) focusTestId(`admin-ticket-${lastId.current}`);
  }, [detailId]);

  if (!can("tickets.read")) return <Text style={styles.hint}>{t("Reading tickets needs the support role.")}</Text>;
  if (ticketDetail) {
    return (
      <View testID="ticket-thread">
        <Affordance accessibilityRole="button" accessibilityLabel={t("BACK TO QUEUE")} testID="ticket-back" onPress={() => setTicketDetail(null)} style={styles.action}>
          <Ionicons name="arrow-back" size={15} color={colors.text} />
          <Text style={styles.actionText}>{t("BACK TO QUEUE")}</Text>
        </Affordance>
        <DetailPanel label={ticketDetail.subject}>
          <View style={styles.cardHead}>
            <Text style={styles.tag}>{t(ticketDetail.category.replace(/_/g, " ").toUpperCase())}</Text>
            <Text style={styles.time}>{formatDate(ticketDetail.updated_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
          </View>
          <Text style={styles.name}>{ticketDetail.subject}</Text>
          <Text style={styles.meta}>{ticketLabel(ticketDetail.user, ticketDetail.user_id)} · {staffTicketStatusLabel(ticketDetail.status, t)}</Text>
          <Text style={styles.meta}>{queueAge(ticketDetail.created_at, ticketDetail.updated_at, t)}</Text>
          {ticketDetail.assignee_id ? <Text style={styles.meta}>{t("Assigned to {name}", { name: ticketLabel(ticketDetail.assignee, ticketDetail.assignee_id) })}</Text> : <Text style={styles.meta}>{t("Unassigned")}</Text>}
          {ticketDetail.messages.length === 0 ? <Text style={styles.hint}>{t("No messages on this ticket yet.")}</Text> : null}
          {ticketDetail.messages.map((message: SupportMessage) => (
            <View key={message.id} style={styles.note} testID={`ticket-message-${message.id}`}>
              <Text style={styles.meta}>{t(message.author_role === "staff" ? "STAFF" : "MEMBER")}{message.author ? ` · ${ticketLabel(message.author, message.author_id)}` : ""} · {formatDate(message.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
              <Text style={styles.noteText}>{message.body}</Text>
            </View>
          ))}
          {can("tickets.write") ? <>
            <Text style={styles.section}>{t("STATUS")}</Text>
            <FilterBar label={t("Ticket status")}>
              {TICKET_STATUSES.map(item => (
                <Affordance key={item} accessibilityRole="button" accessibilityLabel={staffTicketStatusLabel(item, t)} {...selectedControl(draftStatus === item)} testID={`ticket-status-${item}`} onPress={() => setDraftStatus(item)} style={[styles.chip, draftStatus === item && styles.chipActive]}>
                  <Text style={[styles.chipText, draftStatus === item && styles.chipTextActive]}>{staffTicketStatusLabel(item, t)}</Text>
                </Affordance>
              ))}
            </FilterBar>
            <Affordance accessibilityRole="button" accessibilityLabel={t("SAVE STATUS")} testID="ticket-save-status" disabled={working || draftStatus === ticketDetail.status} onPress={() => void saveTicketStatus()} style={[styles.action, (working || draftStatus === ticketDetail.status) && styles.disabled]}>
              <Text style={styles.actionText}>{t("SAVE STATUS")}</Text>
            </Affordance>
            <Text style={styles.section}>{t("REPLY")}</Text>
            <TextInput value={reply} onChangeText={setReply} maxLength={5000} multiline accessibilityLabel={t("Reply to the member")} placeholder={t("Reply to the member")} placeholderTextColor={colors.textDim} style={[styles.input, styles.replyInput]} testID="ticket-reply" />
            <Affordance accessibilityRole="button" accessibilityLabel={t("SEND REPLY")} testID="ticket-send-reply" disabled={working || reply.trim().length === 0} onPress={() => void sendReply()} style={[styles.action, (working || reply.trim().length === 0) && styles.disabled]}>
              <Ionicons name="send-outline" size={15} color={colors.text} />
              <Text style={styles.actionText}>{t("SEND REPLY")}</Text>
            </Affordance>
            <Text style={styles.hint}>{t("A reply marks the ticket pending so the member knows staff has answered.")}</Text>
          </> : <Text style={styles.hint}>{t("Read-only: replying to tickets needs the support role.")}</Text>}
        </DetailPanel>
      </View>
    );
  }
  return (
    <>
      <FilterBar label={t("Support queue")}>
        {TICKET_STATUSES.map(item => (
          <Affordance key={item} accessibilityRole="button" accessibilityLabel={staffTicketStatusLabel(item, t)} {...selectedControl(ticketStatus === item)} testID={`ticket-filter-${item}`} onPress={() => setTicketStatus(item)} style={[styles.chip, ticketStatus === item && styles.chipActive]}>
            <Text style={[styles.chipText, ticketStatus === item && styles.chipTextActive]}>{staffTicketStatusLabel(item, t)}</Text>
          </Affordance>
        ))}
        <Affordance accessibilityRole="button" accessibilityLabel={t("Unassigned")} {...selectedControl(unassignedOnly)} testID="ticket-filter-unassigned" onPress={() => setUnassignedOnly(value => !value)} style={[styles.chip, unassignedOnly && styles.chipActive]}>
          <Text style={[styles.chipText, unassignedOnly && styles.chipTextActive]}>{t("Unassigned")}</Text>
        </Affordance>
      </FilterBar>
      <View style={styles.searchRow}>
        <TextInput value={ticketQuery} onChangeText={onTicketQuery} onSubmitEditing={submitTicketSearch} maxLength={80} accessibilityLabel={t("Search by subject, email, or ticket id")} placeholder={t("Search by subject, email, or ticket id")} placeholderTextColor={colors.textDim} style={[styles.input, { flex: 1, marginBottom: 0 }]} testID="admin-ticket-search" />
        <Affordance accessibilityRole="button" accessibilityLabel={t("Search")} disabled={working} onPress={submitTicketSearch} style={styles.searchBtn}><Ionicons name="search" size={18} color={colors.text} /></Affordance>
      </View>
      <QueueList
        t={t}
        formatDate={formatDate}
        loading={tickets === null && !sectionErrors.support}
        error={sectionErrors.support}
        onRetry={() => retrySection("support")}
        retryLabel={t("Retry support queue")}
        updatedAt={updatedAt.support}
        empty={tickets && visibleTickets.length === 0 && !sectionErrors.support ? t(unassignedOnly && tickets.length > 0 ? "No unassigned tickets." : "The support queue is empty.") : null}
        loaded={visibleTickets.length}
        total={ticketTotal}
        nextCursor={ticketCursor}
        onMore={() => void moreTickets()}
        queueLabel={t("tickets")}
        footerLoading={working}
      >
        {visibleTickets.map(ticket => (
          <Affordance key={ticket.id} accessibilityRole="button" accessibilityLabel={ticket.subject} testID={`admin-ticket-${ticket.id}`} onPress={() => void openTicket(ticket.id)} style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name}>{ticket.subject}</Text>
              <Text style={styles.meta}>{ticketLabel(ticket.user, ticket.user_id)} · {t(ticket.category.replace(/_/g, " ").toUpperCase())}</Text>
              <Text style={styles.meta}>{queueAge(ticket.created_at, ticket.updated_at, t)}{ticket.assignee_id ? "" : ` · ${t("Unassigned")}`}</Text>
            </View>
            <View style={styles.staffTag}><Text style={styles.staffTagText}>{staffTicketStatusLabel(ticket.status, t)}</Text></View>
            <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
          </Affordance>
        ))}
      </QueueList>
    </>
  );
}
