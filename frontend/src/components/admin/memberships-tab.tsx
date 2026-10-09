import { Linking, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Affordance } from "@/src/press-affordance";
import { colors } from "@/src/theme";
import { webOrigin } from "@/src/share";
import { MEMBERSHIP_STATUSES, membershipStatusLabel } from "./admin-labels";
import { ConfirmAction } from "./confirm-action";
import { consoleStyles as styles } from "./console-styles";
import { DetailPanel } from "./detail-panel";
import { FilterBar } from "./filter-bar";
import { FilterChip } from "./filter-chip";
import { QueueList } from "./queue-list";
import { StatusBadge } from "./status-badge";
import type { AdminConsoleModel } from "./use-admin-console";

function openMemberCommunity(id: string) {
  const origin = webOrigin();
  if (!origin) return;
  void Linking.openURL(`${origin}/community/${encodeURIComponent(id)}`);
}

export function MembershipsTab({ model }: { model: AdminConsoleModel }) {
  const { t, formatDate, joins, joinTotal, joinCursor, joinStatus, setJoinStatus, sectionErrors, updatedAt, reason, setReason, working, can, loading, moreJoins, pending, setPending, confirmPending, openUser, retrySection } = model;
  return (
    <>
      <FilterBar label={t("Membership status")}>
        {MEMBERSHIP_STATUSES.map(item => (
          <FilterChip key={item} label={t(membershipStatusLabel(item))} selected={joinStatus === item} testID={`membership-filter-${item}`} onPress={() => setJoinStatus(item)} />
        ))}
      </FilterBar>
      {joinStatus === "pending" ? <Text style={styles.hint} testID="membership-waiting-hint">{t("Accept or decline a waiting request. Paid communities still need verified billing.")}</Text> : null}
      <QueueList
        t={t}
        formatDate={formatDate}
        error={sectionErrors.joins}
        onRetry={() => retrySection("joins")}
        retryLabel={t("Retry memberships")}
        updatedAt={updatedAt.joins}
        empty={!loading && !sectionErrors.joins && joins.length === 0 ? t(joinStatus === "pending" ? "No join requests waiting." : "Nothing in this list.") : null}
        loaded={joins.length}
        total={joinTotal}
        nextCursor={joinCursor}
        onMore={() => void moreJoins()}
        queueLabel={t("memberships")}
        footerLoading={working}
      >
        {joinStatus === "pending" && joins.length ? <TextInput value={reason} onChangeText={setReason} maxLength={500} accessibilityLabel={t("Reason (required, saved to the audit log)")} placeholder={t("Reason (required, saved to the audit log)")} placeholderTextColor={colors.textDim} style={styles.input} /> : null}
        {joins.map(row => (
          <DetailPanel key={row.id} testID={`admin-join-${row.id}`}>
            <View style={styles.cardHead}>
              <Text style={styles.name}>{row.user?.full_name || row.user?.email || t("Unknown")}</Text>
              <StatusBadge tone={joinStatus === "pending" ? "warning" : joinStatus === "banned" ? "danger" : "neutral"} label={t(membershipStatusLabel(joinStatus))} />
            </View>
            <Text style={styles.meta}>{row.user?.email}</Text>
            <Text style={styles.meta}>{row.community?.name || t("Unknown")} · {formatDate(row.created_at, { day: "numeric", month: "short" })}</Text>
            {joinStatus === "pending" ? (can("content.moderate") ? <View style={styles.actions}>
              <Affordance accessibilityRole="button" accessibilityLabel={t("Reject request {id}", { id: row.id })} disabled={working || reason.trim().length < 5} onPress={() => setPending({ kind: "membership", row, decision: "rejected" })} style={[styles.action, (working || reason.trim().length < 5) && styles.disabled]}>
                <Ionicons name="close" size={15} color={colors.error} />
                <Text style={styles.actionText}>{t("Reject")}</Text>
              </Affordance>
              <Affordance accessibilityRole="button" accessibilityLabel={t("Approve request {id}", { id: row.id })} disabled={working || reason.trim().length < 5} onPress={() => setPending({ kind: "membership", row, decision: "active" })} style={[styles.action, (working || reason.trim().length < 5) && styles.disabled]}>
                <Ionicons name="checkmark" size={15} color={colors.text} />
                <Text style={styles.actionText}>{t("Approve")}</Text>
              </Affordance>
            </View> : <Text style={styles.hint}>{t("Read-only: reviewing requests needs the moderator role.")}</Text>) : null}
            {pending?.kind === "membership" && pending.row.id === row.id ? (
              <ConfirmAction
                testID={`confirm-membership-${pending.decision}-${row.id}`}
                title={t(pending.decision === "active" ? "Approve this request" : "Decline this request")}
                body={t(pending.decision === "active" ? "The member joins the community." : "The request is declined.")}
                confirmLabel={t(pending.decision === "active" ? "Approve" : "Reject")}
                reason={reason}
                minReason={5}
                onConfirm={next => confirmPending(next)}
                onCancel={() => setPending(null)}
                busy={working}
                t={t}
              />
            ) : null}
            <View style={styles.actions}>
              <Affordance accessibilityRole="button" accessibilityLabel={t("Open account")} onPress={() => void openUser(row.user_id)} style={styles.action}><Text style={styles.actionText}>{t("Open account")}</Text></Affordance>
              {row.community ? <Affordance accessibilityRole="button" accessibilityLabel={t("OPEN COMMUNITY")} onPress={() => openMemberCommunity(row.community_id)} style={styles.action}><Text style={styles.actionText}>{t("OPEN COMMUNITY")}</Text></Affordance> : null}
            </View>
          </DetailPanel>
        ))}
      </QueueList>
    </>
  );
}
