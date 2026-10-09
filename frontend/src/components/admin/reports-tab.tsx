import { Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Affordance } from "@/src/press-affordance";
import { colors } from "@/src/theme";
import { ADMIN_QUEUE_TARGET_HOURS, agePhrase, isOverdue, queueAge } from "./queue-age";
import { RESOLUTIONS, isReportTargetType, reportTypeLabel } from "./admin-labels";
import { consoleStyles as styles } from "./console-styles";
import { ConfirmAction } from "./confirm-action";
import { DetailPanel } from "./detail-panel";
import { FilterBar } from "./filter-bar";
import { FilterChip } from "./filter-chip";
import { StatusBadge } from "./status-badge";
import { QueueList } from "./queue-list";
import type { AdminConsoleModel } from "./use-admin-console";

export function ReportsTab({ model }: { model: AdminConsoleModel }) {
  const { t, formatDate, reports, reportStatus, reportType, reportTotal, reportCursor, sectionErrors, updatedAt, reason, setReason, working, can, loading, overview, loadReports, moreReports, resolve, retryReport, confirmRetryId, setConfirmRetryId, pending, setPending, confirmPending, openUser, retrySection } = model;
  const shownReports = reports.filter(row => reportType === "all" || row.target_type === reportType);
  const reportTypes = reports.map(row => row.target_type).filter(isReportTargetType).filter((type, index, all) => all.indexOf(type) === index);
  const oldest = reportStatus === "open" ? overview?.queues.oldest_open_report_at : null;
  const overdue = isOverdue(oldest);
  return (
    <>
      <FilterBar label={t("Report status")}>
        {(["open", "resolved"] as const).map(item => (
          <FilterChip key={item} label={t(item === "open" ? "Open reports" : "Resolved reports")} selected={reportStatus === item} onPress={() => void loadReports(item)}>
            {t(item === "open" ? "OPEN" : "RESOLVED")}
          </FilterChip>
        ))}
      </FilterBar>
      {reportStatus === "resolved" ? <Text style={styles.hint}>{t("Resolved reports stay here so a decision can be checked later.")}</Text> : null}
      {oldest ? (
        <Text style={[styles.hint, overdue && styles.partial]}>
          {t("Oldest report opened {age}.", { age: agePhrase(oldest, t) })}
          {overdue ? ` ${t("Past the {hours}h target.", { hours: ADMIN_QUEUE_TARGET_HOURS })}` : ""}
        </Text>
      ) : null}
      {reportTypes.length > 0 ? <FilterBar label={t("Report type")}>
        <FilterChip label={t("All types")} selected={reportType === "all"} testID="report-type-all" onPress={() => { void loadReports(reportStatus, "all"); }} />
        {reportTypes.map(type => (
          <FilterChip key={type} label={t(reportTypeLabel(type))} selected={reportType === type} testID={`report-type-${type}`} onPress={() => { void loadReports(reportStatus, type); }} />
        ))}
      </FilterBar> : null}
      <QueueList
        t={t}
        formatDate={formatDate}
        error={sectionErrors.reports}
        onRetry={() => retrySection("reports")}
        retryLabel={t("Retry reports")}
        updatedAt={updatedAt.reports}
        empty={!loading && !sectionErrors.reports && reports.length === 0 ? t("The moderation queue is empty.") : !sectionErrors.reports && reports.length > 0 && shownReports.length === 0 ? t("Nothing in this list.") : null}
        loaded={shownReports.length}
        total={reportTotal}
        nextCursor={reportCursor}
        onMore={() => void moreReports()}
        queueLabel={t("reports")}
        footerLoading={working}
      >
        {shownReports.length ? <TextInput value={reason} onChangeText={setReason} maxLength={1000} accessibilityLabel={t("Decision note (stored in the audit log)")} placeholder={t("Decision note (stored in the audit log)")} placeholderTextColor={colors.textDim} style={styles.input} /> : null}
        {shownReports.map(report => (
          <DetailPanel key={report.id} testID={`report-${report.id}`}>
            <View style={styles.cardHead}>
              <StatusBadge tone="danger" label={t(report.reason.replace(/_/g, " ").toUpperCase())} />
              <Text style={styles.time}>{formatDate(report.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
            <Text style={styles.meta} testID={`report-age-${report.id}`}>{queueAge(report.created_at, report.reviewed_at, t)}</Text>
            <Text style={styles.meta}>{t("{type} by {name}", { type: t(isReportTargetType(report.target_type) ? reportTypeLabel(report.target_type) : report.target_type), name: report.reported_user?.full_name || report.reported_user?.email || t("Unknown") })}</Text>
            {report.content_snapshot ? <Text style={styles.snapshot}>“{report.content_snapshot}”</Text> : null}
            {report.detail ? <Text style={styles.meta}>{t("Reporter said:")} {report.detail}</Text> : null}
            {report.resolution ? <Text style={styles.meta}>{t(report.resolution.replace(/_/g, " ").toUpperCase())}</Text> : null}
            {report.resolution_status === "partial" ? <StatusBadge tone="warning" label={t("Partial resolution. The side effect can be retried.")} /> : null}
            {report.resolution_status === "retrying" && report.retry_claimable ? <StatusBadge tone="warning" label={t("The previous retry stopped. It can be run again.")} /> : null}
            {report.resolution_status === "retrying" && !report.retry_claimable ? <StatusBadge tone="info" label={t("A retry is in progress.")} /> : null}
            {reportStatus === "open" || report.resolution_status === "partial" || (report.resolution_status === "retrying" && report.retry_claimable) ? (can("reports.resolve") ? <View style={styles.actions}>
              {report.resolution_status === "partial" || report.resolution_status === "retrying" ? (
                <Affordance accessibilityRole="button" accessibilityLabel={t("Retry side effect for report {id}", { id: report.id })} testID={`report-retry-${report.id}`} disabled={working} onPress={() => setConfirmRetryId(report.id)} style={[styles.action, working && styles.disabled]}>
                  <Text style={styles.actionText}>{t("RETRY")}</Text>
                </Affordance>
              ) : RESOLUTIONS.map(option => {
                if (option.key === "user_suspended" && !report.reported_user) return null;
                const needsReason = option.key === "user_suspended" && reason.trim().length < 10;
                return (
                  <Affordance key={option.key} accessibilityRole="button" accessibilityLabel={t("{action} report {id}", { action: t(option.label), id: report.id })} accessibilityState={{ disabled: working || needsReason }} testID={`resolve-${option.key}-${report.id}`} disabled={working || needsReason} onPress={() => {
                    if (option.key === "content_removed" || option.key === "user_suspended") setPending({ kind: "resolve", report, resolution: option.key });
                    else void resolve(report, option.key);
                  }} style={[styles.action, (working || needsReason) && styles.disabled]}>
                    <Ionicons name={option.icon} size={15} color={option.key === "content_removed" || option.key === "user_suspended" ? colors.error : colors.text} />
                    <Text style={styles.actionText}>{t(option.label)}</Text>
                  </Affordance>
                );
              })}
            </View> : <Text style={styles.hint}>{t("Read-only: resolving reports needs the moderator role.")}</Text>) : null}
            {confirmRetryId === report.id ? (
              <ConfirmAction
                testID={`report-retry-dialog-${report.id}`}
                title={t("Retry the side effect")}
                body={t("The report stays resolved. This runs the removal, suspension, or notice again.")}
                confirmLabel={t("RETRY")}
                onConfirm={() => void retryReport(report)}
                onCancel={() => setConfirmRetryId(null)}
                busy={working}
                t={t}
              />
            ) : null}
            {pending?.kind === "resolve" && pending.report.id === report.id ? (
              <ConfirmAction
                testID={`confirm-resolve-${pending.resolution}-${report.id}`}
                title={t(pending.resolution === "user_suspended" ? "Suspend the reported account" : "Remove the reported content")}
                body={t(pending.resolution === "user_suspended" ? "The report is resolved and the account is suspended." : "The report is resolved and the content is removed.")}
                confirmLabel={t(pending.resolution === "user_suspended" ? "SUSPEND" : "REMOVE")}
                reason={reason}
                minReason={pending.resolution === "user_suspended" ? 10 : 0}
                onConfirm={next => confirmPending(next)}
                onCancel={() => setPending(null)}
                busy={working}
                t={t}
              />
            ) : null}
            {report.reported_user ? <Affordance accessibilityRole="button" accessibilityLabel={t("Open account")} onPress={() => void openUser(report.reported_user!.id)}><Text style={styles.link}>{t("Open account")}</Text></Affordance> : null}
          </DetailPanel>
        ))}
      </QueueList>
    </>
  );
}
