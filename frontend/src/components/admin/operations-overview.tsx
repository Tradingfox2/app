import { Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Affordance } from "@/src/press-affordance";
import type { AdminOverview, HealthReport } from "@/src/api";
import { radius, spacing } from "@/src/theme";
import { staffColors as colors, staffFonts, staffType } from "./staff-theme";
import { ADMIN_QUEUE_TARGET_HOURS, agePhrase, isOverdue } from "./queue-age";

type Translate = (source: string, values?: Record<string, string | number>) => string;
type FormatNumber = (value: number) => string;

function Metric({
  value, label, hint, onPress, testID,
}: {
  value: string;
  label: string;
  hint?: string;
  onPress?: () => void;
  testID?: string;
}) {
  const body = (
    <>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {hint ? <Text style={styles.metricHint}>{hint}</Text> : null}
    </>
  );
  if (onPress) {
    return (
      <Affordance
        accessibilityRole="button"
        accessibilityHint={hint}
        onPress={onPress}
        style={styles.metric}
        testID={testID}
        {...(Platform.OS === "web" && hint ? { title: hint } : {})}
      >
        {body}
      </Affordance>
    );
  }
  return <View accessibilityHint={hint} style={styles.metric} testID={testID}>{body}</View>;
}

function WorkMix({
  reports, tickets, applications, total, t, formatNumber,
}: {
  reports: number;
  tickets: number;
  applications: number;
  total: number;
  t: Translate;
  formatNumber: FormatNumber;
}) {
  const parts = [
    { key: "reports", label: t("Open reports"), value: reports, color: colors.error },
    { key: "tickets", label: t("Needs reply"), value: tickets, color: colors.warning },
    { key: "applications", label: t("Pending applications"), value: applications, color: colors.info },
  ];
  if (total <= 0) {
    return <Text style={styles.hint}>{t("No open work in these queues.")}</Text>;
  }
  return (
    <View testID="admin-work-mix" accessibilityLabel={t("Open work, right now")}>
      <Text style={styles.mixLabel}>{t("Open work, right now")}</Text>
      <View style={styles.mixTrack}>
        {parts.map(part => part.value > 0 ? (
          <View key={part.key} style={{ flexGrow: part.value, flexBasis: 0, height: 8, backgroundColor: part.color }} />
        ) : null)}
      </View>
      <View style={styles.mixLegend}>
        {parts.map(part => (
          <Text key={part.key} style={styles.mixItem}>{part.label} · {formatNumber(part.value)}</Text>
        ))}
      </View>
    </View>
  );
}

export function OperationsOverview({
  overview,
  health,
  sectionErrors,
  onOpenReports,
  onOpenTickets,
  onOpenUnassigned,
  onOpenCoaches,
  onOpenJoins,
  onOpenUsers,
  onOpenCommunities,
  canReviewCoaches,
  t,
  formatNumber,
  formatDate,
}: {
  overview: AdminOverview;
  health: HealthReport | null;
  sectionErrors: { reports?: string; users?: string; audit?: string };
  onOpenReports: () => void;
  onOpenTickets: (status: "open" | "pending") => void;
  onOpenUnassigned: () => void;
  onOpenCoaches: () => void;
  onOpenJoins: () => void;
  onOpenUsers: (status: "all" | "suspended") => void;
  onOpenCommunities: () => void;
  canReviewCoaches: boolean;
  t: Translate;
  formatNumber: FormatNumber;
  formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string;
}) {
  const openTickets = overview.queues.open_tickets ?? 0;
  const pendingTickets = overview.queues.pending_tickets ?? 0;
  const applications = overview.queues.pending_coach_applications + overview.queues.pending_memberships;
  const unassigned = overview.queues.unassigned_open_tickets;
  const verifiedHealthy = health?.phase === "verified" && health.status === "ok" && health.mongo === true;
  const verifiedDown = health?.phase === "verified" && health.mongo === false;
  const statusValue = !health ? "…" : verifiedHealthy ? t("Healthy") : verifiedDown ? t("Unavailable") : t("Unverified");
  const statusHint = !health
    ? t("Checking the health endpoint…")
    : verifiedHealthy
      ? t("Verified by the health check. Mongo answered.")
      : verifiedDown
        ? t("The health check ran and Mongo did not answer.")
        : t("The health check did not succeed, so this is not shown as healthy.");
  const oldestReport = overview.queues.oldest_open_report_at;
  const oldestTicket = overview.queues.oldest_unassigned_ticket_at;
  const reportOverdue = isOverdue(oldestReport);
  const ticketOverdue = isOverdue(oldestTicket);
  const overdueNote = t("Past the {hours}h target.", { hours: ADMIN_QUEUE_TARGET_HOURS });
  const stockHint = t("Active communities on the platform (not a 24h count).");
  const activityHint = t("Counts in the last 24 hours.");
  const sectionError = [sectionErrors.reports, sectionErrors.users, sectionErrors.audit].filter(Boolean).join(" ");

  const mixTotal = overview.queues.open_reports + openTickets + applications;

  return (
    <>
      <Text style={styles.section}>{t("QUEUES")}</Text>
      <WorkMix
        reports={overview.queues.open_reports}
        tickets={openTickets}
        applications={applications}
        total={mixTotal}
        t={t}
        formatNumber={formatNumber}
      />
      {overview.generated_at ? (
        <Text style={styles.hint}>{t("Updated {time}.", { time: formatDate(overview.generated_at, { dateStyle: "short", timeStyle: "short" }) })}</Text>
      ) : (
        <Text style={styles.hint}>{t("This overview did not include an update time.")}</Text>
      )}
      {sectionError ? <Text accessibilityRole="alert" style={styles.error}>{sectionError}</Text> : null}
      <View style={styles.grid}>
        <Metric
          testID="admin-queue-open_reports"
          value={formatNumber(overview.queues.open_reports)}
          label={t("Open reports")}
          hint={t("Open moderation queue. Platform moderation queue (not community-local).")}
          onPress={onOpenReports}
        />
        <Metric
          testID="admin-queue-pending_tickets"
          value={formatNumber(pendingTickets)}
          label={t("Pending tickets")}
          hint={`${t("Waiting on member")}. ${t("Review support workload")}`}
          onPress={() => onOpenTickets("pending")}
        />
        <Metric
          testID="admin-queue-open_tickets"
          value={formatNumber(openTickets)}
          label={t("Needs reply")}
          hint={t("{count} open need a reply.", { count: openTickets })}
          onPress={() => onOpenTickets("open")}
        />
        <View style={styles.metric} testID="admin-queue-pending_applications">
          <Text style={styles.metricValue}>{formatNumber(applications)}</Text>
          <Text style={styles.metricLabel}>{t("Pending applications")}</Text>
          <Text style={styles.metricHint}>{t("Coach and membership queues")}</Text>
          <Text style={styles.metricHint}>
            {t("{coaches} coach applications · {joins} join requests", {
              coaches: formatNumber(overview.queues.pending_coach_applications),
              joins: formatNumber(overview.queues.pending_memberships),
            })}
          </Text>
          <View style={styles.inline}>
            {canReviewCoaches ? (
              <Affordance accessibilityRole="button" onPress={onOpenCoaches}><Text style={styles.link}>{t("Open coaches")}</Text></Affordance>
            ) : null}
            <Affordance accessibilityRole="button" onPress={onOpenJoins}>
              <Text style={styles.link}>{t("Open memberships")}</Text>
            </Affordance>
          </View>
          <Text testID="admin-queue-pending_memberships" style={styles.metricHint}>{t("Memberships waiting for approval across all communities.")}</Text>
        </View>
        <View style={styles.metric} testID="admin-system-status" accessibilityRole="text">
          <Text style={styles.metricValue}>{statusValue}</Text>
          <Text style={styles.metricLabel}>{t("System status")}</Text>
          <Text style={styles.metricHint}>{statusHint}</Text>
        </View>
      </View>

      <Text style={styles.section}>{t("Priority work queue")}</Text>
      <View style={styles.queue}>
        <Affordance accessibilityRole="button" accessibilityLabel={t("Reports awaiting review")} testID="admin-priority-reports" onPress={onOpenReports} style={[styles.queueRow, reportOverdue && styles.overdue]}>
          <Ionicons name="flag-outline" size={18} color={reportOverdue ? colors.error : colors.text} />
          <View style={styles.queueCopy}>
            <Text style={styles.name}>{t("Reports awaiting review")}</Text>
            <Text style={styles.meta}>{t("Sorted by policy urgency, then waiting time.")}</Text>
            {oldestReport ? <Text style={styles.meta}>{t("Oldest report opened {age}.", { age: agePhrase(oldestReport, t) })}</Text> : null}
            {reportOverdue ? <Text style={styles.overdueText}>{overdueNote}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
        </Affordance>
        <Affordance accessibilityRole="button" accessibilityLabel={t("Unassigned support tickets")} testID="admin-priority-unassigned" onPress={onOpenUnassigned} style={[styles.queueRow, ticketOverdue && styles.overdue]}>
          <Ionicons name="chatbubbles-outline" size={18} color={ticketOverdue ? colors.error : colors.text} />
          <View style={styles.queueCopy}>
            <Text style={styles.name}>{t("Unassigned support tickets")}</Text>
            <Text style={styles.meta}>{t("Assignment, status, last update and next action.")}</Text>
            {typeof unassigned === "number" ? <Text style={styles.meta}>{t("{count} open and unassigned.", { count: formatNumber(unassigned) })}</Text> : null}
            {oldestTicket ? <Text style={styles.meta} testID="admin-priority-unassigned-age">{t("Oldest unassigned ticket opened {age}.", { age: agePhrase(oldestTicket, t) })}</Text> : null}
            {ticketOverdue ? <Text style={styles.overdueText}>{overdueNote}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
        </Affordance>
        <View style={styles.queueRow} testID="admin-priority-alerts">
          <Ionicons name="shield-outline" size={18} color={colors.text} />
          <View style={styles.queueCopy}>
            <Text style={styles.name}>{t("Security and operational alerts")}</Text>
            <Text style={styles.meta}>
              {verifiedDown
                ? t("The health check ran and Mongo did not answer.")
                : t("No verified security alerts. This row only lists a check the server confirmed.")}
            </Text>
            <Text style={styles.meta}>{t("Only verified alerts, with the check that produced them.")}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.section}>{t("MEMBERS")}</Text>
      <View style={styles.grid}>
        <Affordance accessibilityRole="button" onPress={() => onOpenUsers("all")} style={styles.metric}>
          <Text style={styles.metricValue}>{formatNumber(overview.users.total)}</Text>
          <Text style={styles.metricLabel}>{t("Total")}</Text>
        </Affordance>
        <Affordance accessibilityRole="button" onPress={() => onOpenUsers("suspended")} style={styles.metric}>
          <Text style={styles.metricValue}>{formatNumber(overview.users.suspended)}</Text>
          <Text style={styles.metricLabel}>{t("Suspended")}</Text>
        </Affordance>
        {canReviewCoaches ? (
          <Affordance accessibilityRole="button" onPress={onOpenCoaches} style={styles.metric}>
            <Text style={styles.metricValue}>{formatNumber(overview.users.coaches)}</Text>
            <Text style={styles.metricLabel}>{t("Approved coaches")}</Text>
          </Affordance>
        ) : (
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{formatNumber(overview.users.coaches)}</Text>
            <Text style={styles.metricLabel}>{t("Approved coaches")}</Text>
          </View>
        )}
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{formatNumber(overview.users.new_7d)}</Text>
          <Text style={styles.metricLabel}>{t("New (7 days)")}</Text>
        </View>
      </View>
      <Text style={styles.section} testID="admin-section-stock">{t("STOCK")}</Text>
      <View style={styles.grid}>
        <Metric testID="admin-stock-communities" value={formatNumber(overview.activity.communities)} label={t("Total communities")} hint={stockHint} onPress={onOpenCommunities} />
      </View>
      <Text style={styles.section} testID="admin-section-activity">{t("LAST 24 HOURS")}</Text>
      <View style={styles.grid}>
        {([
          ["workouts_24h", "Workouts"],
          ["posts_24h", "Posts"],
          ["messages_24h", "Messages"],
        ] as const).map(([key, label]) => (
          <Metric key={key} testID={`admin-activity-${key}`} value={formatNumber(overview.activity[key])} label={t(label)} hint={activityHint} />
        ))}
      </View>
      <Text style={styles.hint}>{t("Your permissions:")} {overview.permissions.join(", ")}</Text>
      <Text style={styles.hint}>{t("Health data (labs, biomarkers) and private messages are never shown in this console. Reported content is shown only on a report.")}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  section: { ...staffType.section, marginTop: spacing.lg },
  hint: { color: colors.textMuted, fontFamily: staffFonts.text, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  error: { color: colors.error, marginTop: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { minWidth: 148, flexGrow: 1, flexBasis: "46%", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  metricValue: { color: colors.text, fontFamily: staffFonts.display, fontSize: 32, lineHeight: 36, fontVariant: ["tabular-nums"] },
  metricLabel: { color: colors.textMuted, fontFamily: staffFonts.text, fontSize: 12, marginTop: 2 },
  metricHint: { color: colors.textDim, fontFamily: staffFonts.text, fontSize: 11, lineHeight: 15, marginTop: 4 },
  mixLabel: { color: colors.textMuted, fontFamily: staffFonts.text, fontSize: 12, marginTop: spacing.md, marginBottom: spacing.xs },
  mixTrack: { flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.surface3, gap: 2 },
  mixLegend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xs },
  mixItem: { color: colors.text, fontFamily: staffFonts.text, fontSize: 12 },
  inline: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.sm },
  link: { color: colors.brand, fontSize: 12, fontWeight: "800" },
  queue: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, overflow: "hidden" },
  queueRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  overdue: { backgroundColor: colors.errorWash, borderBottomColor: colors.error },
  overdueText: { color: colors.error, fontSize: 12, fontWeight: "800" },
  queueCopy: { flex: 1 },
  name: { color: colors.text, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
