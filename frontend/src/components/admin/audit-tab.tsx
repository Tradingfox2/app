import { Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Affordance } from "@/src/press-affordance";
import { selectedControl } from "@/src/community-copy";
import { colors } from "@/src/theme";
import { consoleStyles as styles } from "./console-styles";
import { QueueList } from "./queue-list";
import type { AdminConsoleModel } from "./use-admin-console";

export function AuditTab({ model }: { model: AdminConsoleModel }) {
  const {
    t, formatDate, audit, auditTotal, auditCursor, auditActor, setAuditActor, auditAction, setAuditAction,
    auditTarget, setAuditTarget, auditFrom, setAuditFrom, auditTo, setAuditTo, auditOutcome, setAuditOutcome, working, sectionErrors,
    updatedAt, loading, searchAudit, moreAudit, retrySection,
  } = model;
  return (
    <>
      <Text style={styles.hint}>{t("Append-only record of staff actions. Failed and denied attempts are stored with an outcome and a reason code. The request body is not copied.")}</Text>
      <View style={styles.filters}>
        {(["", "success", "failed", "denied"] as const).map(item => {
          const label = item === "" ? "All outcomes" : item === "success" ? "Succeeded" : item === "failed" ? "Failed" : "Denied";
          const selected = auditOutcome === item;
          return (
            <Affordance key={label} accessibilityRole="button" accessibilityLabel={t(label)} {...selectedControl(selected)} testID={`audit-outcome-${item || "all"}`} onPress={() => setAuditOutcome(item)} style={[styles.chip, selected && styles.chipActive]}>
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{t(label)}</Text>
            </Affordance>
          );
        })}
      </View>
      <TextInput value={auditActor} onChangeText={setAuditActor} maxLength={80} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t("Actor email or id")} placeholder={t("Actor email or id")} placeholderTextColor={colors.textDim} style={styles.input} testID="audit-filter-actor" />
      <TextInput value={auditAction} onChangeText={setAuditAction} maxLength={80} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t("Action prefix")} placeholder={t("Action prefix")} placeholderTextColor={colors.textDim} style={styles.input} testID="audit-filter-action" />
      <TextInput value={auditTarget} onChangeText={setAuditTarget} maxLength={80} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t("Target id")} placeholder={t("Target id")} placeholderTextColor={colors.textDim} style={styles.input} testID="audit-filter-target" />
      <View style={styles.searchRow}>
        <TextInput value={auditFrom} onChangeText={setAuditFrom} maxLength={10} autoCapitalize="none" accessibilityLabel={t("From (YYYY-MM-DD)")} placeholder={t("From (YYYY-MM-DD)")} placeholderTextColor={colors.textDim} style={[styles.input, { flex: 1 }]} testID="audit-filter-from" />
        <TextInput value={auditTo} onChangeText={setAuditTo} maxLength={10} autoCapitalize="none" accessibilityLabel={t("To (YYYY-MM-DD)")} placeholder={t("To (YYYY-MM-DD)")} placeholderTextColor={colors.textDim} style={[styles.input, { flex: 1 }]} testID="audit-filter-to" />
      </View>
      <Affordance accessibilityRole="button" accessibilityLabel={t("Search the audit log")} disabled={working} onPress={() => void searchAudit()} style={styles.action} testID="audit-search">
        <Ionicons name="search" size={15} color={colors.text} />
        <Text style={styles.actionText}>{t("Search the audit log")}</Text>
      </Affordance>
      <QueueList
        t={t}
        formatDate={formatDate}
        error={sectionErrors.audit}
        onRetry={() => retrySection("audit")}
        retryLabel={t("Retry the audit log")}
        updatedAt={updatedAt.audit}
        empty={!loading && !sectionErrors.audit && audit.length === 0 ? t("No staff actions recorded yet.") : null}
        loaded={audit.length}
        total={auditTotal}
        nextCursor={auditCursor}
        onMore={() => void moreAudit()}
        queueLabel={t("audit log")}
        footerLoading={working}
      >
        {audit.map(entry => {
          const from = entry.metadata?.from;
          const to = entry.metadata?.to;
          const change = typeof from === "string" && typeof to === "string" ? `${from} → ${to}` : null;
          const outcome = entry.outcome === "failed" || entry.outcome === "denied" ? entry.outcome : null;
          return (
            <View key={entry.id} style={styles.auditRow}>
              <Text style={styles.auditAction}>{entry.action}</Text>
              {outcome ? <Text style={styles.meta}>{t(outcome === "failed" ? "Failed" : "Denied")}{entry.reason_code ? ` · ${entry.reason_code}` : ""}</Text> : null}
              <Text style={styles.meta}>{entry.actor_email} → {entry.target_type}:{entry.target_id.slice(0, 8)}</Text>
              {entry.reason ? <Text style={styles.snapshot}>{entry.reason}</Text> : null}
              {change ? <Text style={styles.meta}>{t("Recorded change:")} {change}</Text> : null}
              <Text style={styles.time}>{formatDate(entry.created_at, { dateStyle: "short", timeStyle: "short" })}</Text>
            </View>
          );
        })}
      </QueueList>
    </>
  );
}
