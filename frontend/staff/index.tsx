import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useFocusEffect } from "expo-router";
import { AdminAccount, AdminCoach, AdminCommunity, AdminMembership, AdminOverview, api, AuditEntry, CoachApplicationReview, ModerationReport, StaffRole, SupportMessage, SupportTicket, SupportTicketDetail, SupportTicketStatus } from "@/src/api";
import { AccountingPanel } from "@/src/components/admin/accounting-panel";
import { AnalyticsPanel } from "@/src/components/admin/analytics-panel";
import { staffTicketStatusLabel } from "@/src/components/support/copy";
import { track } from "@/src/analytics";
import { useAuth } from "@/src/auth-context";
import { selectedControl } from "@/src/community-copy";
import { webOrigin } from "@/src/share";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

type Tab = "overview" | "analytics" | "accounting" | "support" | "reports" | "coaches" | "joins" | "communities" | "users" | "team" | "audit";
type CoachFilter = "pending" | "approved" | "rejected" | "suspended";
type Status = "all" | "active" | "suspended" | "staff";

const NAV: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "overview", label: "OVERVIEW", icon: "grid-outline" },
  { id: "analytics", label: "ANALYTICS", icon: "pulse-outline" },
  { id: "accounting", label: "ACCOUNTING", icon: "cash-outline" },
  { id: "support", label: "SUPPORT", icon: "chatbubbles-outline" },
  { id: "reports", label: "REPORTS", icon: "flag-outline" },
  { id: "coaches", label: "COACHES", icon: "ribbon-outline" },
  { id: "joins", label: "Memberships", icon: "enter-outline" },
  { id: "communities", label: "COMMUNITIES", icon: "people-outline" },
  { id: "users", label: "USERS", icon: "person-outline" },
  { id: "team", label: "TEAM", icon: "shield-checkmark-outline" },
  { id: "audit", label: "AUDIT", icon: "list-outline" },
];

const TICKET_STATUSES: SupportTicketStatus[] = ["open", "pending", "closed"];
const MEMBERSHIP_STATUSES = ["pending", "banned", "removed"] as const;
type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
const REPORT_TARGET_TYPES = ["post", "comment", "message", "direct_message", "user", "community"] as const;
type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

function membershipStatusLabel(status: MembershipStatus): string {
  switch (status) {
    case "pending":
      return "Waiting";
    case "banned":
      return "Banned";
    case "removed":
      return "Removed";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function reportTypeLabel(type: ReportTargetType): string {
  switch (type) {
    case "post":
      return "Post";
    case "comment":
      return "Comment";
    case "message":
      return "Message";
    case "direct_message":
      return "Direct message";
    case "user":
      return "User";
    case "community":
      return "Community";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function isReportTargetType(value: string): value is ReportTargetType {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

function agePhrase(iso: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return t("Just now");
  if (minutes < 60) return t("{n}m ago", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("{n}h ago", { n: hours });
  return t("{n}d ago", { n: Math.floor(hours / 24) });
}

/** Same opened / updated line the support queue uses. No update time means the row was never closed or edited. */
function queueAge(
  createdAt: string,
  updatedAt: string | null | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const opened = t("Opened {age}", { age: agePhrase(createdAt, t) });
  if (!updatedAt) return opened;
  return `${opened} · ${t("Updated {age}", { age: agePhrase(updatedAt, t) })}`;
}

function HintedMetric({ value, label, hint, onPress, testID }: {
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
  return (
    <View accessibilityHint={hint} style={styles.metric} testID={testID}>
      {body}
    </View>
  );
}

function ticketLabel(person: { full_name: string | null; email: string | null } | null | undefined, fallback: string): string {
  return person?.full_name || person?.email || fallback;
}

const RESOLUTIONS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "dismissed", label: "DISMISS", icon: "close-circle-outline" },
  { key: "warning_sent", label: "WARN", icon: "alert-circle-outline" },
  { key: "content_removed", label: "REMOVE", icon: "trash-outline" },
];

function openMemberCommunity(id: string) {
  const origin = webOrigin();
  if (!origin) return;
  void Linking.openURL(`${origin}/community/${encodeURIComponent(id)}`);
}

function AdminConsole() {
  const { user, logout } = useAuth();
  const { t, formatDate, formatNumber } = useI18n();
  const leave = () => {
    void logout();
  };
  const [tab, setTab] = useState<Tab>("overview");
  const [applications, setApplications] = useState<CoachApplicationReview[]>([]);
  const [coachFilter, setCoachFilter] = useState<CoachFilter>("pending");
  const [coachDirectory, setCoachDirectory] = useState<AdminCoach[] | null>(null);
  const [note, setNote] = useState("");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [reportStatus, setReportStatus] = useState<"open" | "resolved">("open");
  const [reportType, setReportType] = useState<ReportTargetType | "all">("all");
  const [joins, setJoins] = useState<AdminMembership[]>([]);
  const [joinStatus, setJoinStatus] = useState<"pending" | "banned" | "removed">("pending");
  const [communities, setCommunities] = useState<AdminCommunity[]>([]);
  const [team, setTeam] = useState<AdminAccount[]>([]);
  const [users, setUsers] = useState<AdminAccount[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [ticketStatus, setTicketStatus] = useState<SupportTicketStatus>("open");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [ticketDetail, setTicketDetail] = useState<SupportTicketDetail | null>(null);
  const [draftStatus, setDraftStatus] = useState<SupportTicketStatus>("open");
  const [reply, setReply] = useState("");
  const [ticketReload, setTicketReload] = useState(0);
  const [selected, setSelected] = useState<AdminAccount | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const busy = useRef(false);
  const [working, setWorking] = useState(false);

  const can = (permission: string) => overview?.permissions.includes(permission) ?? false;

  const load = useCallback(async () => {
    const current = ++revision.current;
    setError("");
    try {
      const summary = await api.adminOverview();
      if (current !== revision.current) return;
      setOverview(summary);
      const [reportRows, userRows, auditRows, applicationRows] = await Promise.all([
        summary.permissions.includes("reports.read") ? api.adminReports("open") : Promise.resolve([]),
        api.adminUsers("", "all"),
        summary.permissions.includes("audit.read") ? api.adminAuditLog() : Promise.resolve([]),
        summary.permissions.includes("coaches.review") ? api.coachApplications("pending") : Promise.resolve([]),
      ]);
      if (current !== revision.current) return;
      setReports(reportRows); setUsers(userRows.users); setAudit(auditRows); setApplications(applicationRows);
    } catch (cause) {
      if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!overview) return;
    let cancel = false;
    const fail = (cause: unknown) => {
      if (!cancel) setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    };
    if (tab === "joins") void api.adminMemberships(joinStatus).then(rows => { if (!cancel) setJoins(rows); }).catch(fail);
    if (tab === "communities") void api.adminCommunities().then(rows => { if (!cancel) setCommunities(rows); }).catch(fail);
    if (tab === "team") void api.adminUsers("", "staff").then(rows => { if (!cancel) setTeam(rows.users); }).catch(fail);
    if (tab === "coaches") void api.adminCoaches(coachFilter).then(rows => { if (!cancel) setCoachDirectory(rows); }).catch(fail);
    if (tab === "support") {
      if (!overview.permissions.includes("tickets.read")) {
        setTickets([]);
        return () => { cancel = true; };
      }
      setError("");
      setTickets(null);
      void api.adminTickets(ticketStatus, ticketSearch).then(page => { if (!cancel) setTickets(page.tickets); }).catch(cause => {
        if (!cancel) {
          setTickets([]);
          setError(cause instanceof Error ? cause.message : t("Something went wrong"));
        }
      });
    }
    return () => { cancel = true; };
  }, [tab, overview, joinStatus, coachFilter, ticketStatus, ticketSearch, ticketReload, t]);

  useFocusEffect(useCallback(() => {
    busy.current = false; setWorking(false); setLoading(true); void load();
    return () => { revision.current += 1; };
  }, [load]));

  const act = async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setWorking(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busy.current = false; setWorking(false); }
  };
  const search = (next: Status = status) => act(async () => { setUsers((await api.adminUsers(query, next)).users); });
  const loadReports = (next: "open" | "resolved") => act(async () => {
    setReportStatus(next);
    setReportType("all");
    setReports(await api.adminReports(next));
  });
  const openUser = (id: string) => act(async () => { setTab("users"); setSelected(await api.adminUser(id)); setReason(""); });
  const decideJoin = (row: AdminMembership, decision: "active" | "rejected") => act(async () => {
    await api.adminReviewMembership(row.id, decision, reason.trim());
    setJoins(rows => rows.filter(item => item.id !== row.id));
    setReason("");
    if (joinStatus === "pending") {
      setOverview(current => current ? { ...current, queues: { ...current.queues, pending_memberships: Math.max(0, current.queues.pending_memberships - 1) } } : current);
    }
    setAudit(await api.adminAuditLog());
  });
  const resolve = (report: ModerationReport, resolution: string) => act(async () => {
    await api.adminReviewReport(report.id, resolution, reason.trim());
    setReports(rows => rows.filter(row => row.id !== report.id)); setReason("");
    setAudit(await api.adminAuditLog());
  });
  const reviewApplication = (application: CoachApplicationReview, status: "approved" | "rejected") => act(async () => {
    await api.reviewCoachApplication(application.id, status, reason.trim() || undefined);
    setApplications(rows => rows.filter(row => row.id !== application.id));
    setCoachDirectory(rows => rows ? rows.filter(row => row.application_id !== application.id) : rows);
    setReason("");
    setAudit(await api.adminAuditLog());
  });
  const addNote = (account: AdminAccount) => act(async () => {
    await api.adminAddNote(account.id, note.trim());
    setSelected(await api.adminUser(account.id));
    setNote("");
  });
  const suspend = (account: AdminAccount) => act(async () => {
    const updated = account.suspended_at
      ? await api.adminReinstate(account.id, reason.trim())
      : await api.adminSuspend(account.id, reason.trim());
    setSelected(await api.adminUser(updated.id)); setReason("");
    setUsers(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
    setAudit(await api.adminAuditLog());
  });
  const setRole = (account: AdminAccount, role: StaffRole | null) => act(async () => {
    const updated = await api.adminSetStaffRole(account.id, role, reason.trim());
    setSelected(await api.adminUser(updated.id)); setReason("");
    setAudit(await api.adminAuditLog());
  });
  const openTicket = (id: string) => act(async () => {
    const detail = await api.adminTicket(id);
    setTicketDetail(detail);
    setDraftStatus(detail.status);
    setReply("");
  });
  const rememberTicket = (detail: SupportTicketDetail) => {
    setTicketDetail(detail);
    setDraftStatus(detail.status);
    setTickets(rows => rows ? rows.map(row => row.id === detail.id ? { ...row, status: detail.status, updated_at: detail.updated_at, assignee_id: detail.assignee_id, user: detail.user, assignee: detail.assignee } : row) : rows);
  };
  const saveTicketStatus = () => act(async () => {
    if (!ticketDetail || draftStatus === ticketDetail.status) return;
    await api.adminUpdateTicket(ticketDetail.id, { status: draftStatus });
    rememberTicket(await api.adminTicket(ticketDetail.id));
  });
  const sendReply = () => act(async () => {
    if (!ticketDetail) return;
    const id = ticketDetail.id;
    await api.adminReplyTicket(id, reply.trim());
    track("ticket_replied", { ticket_id: id });
    setReply("");
    let statusError = "";
    try {
      await api.adminUpdateTicket(id, { status: "pending" });
    } catch (cause) {
      statusError = cause instanceof Error ? cause.message : t("Something went wrong");
    }
    rememberTicket(await api.adminTicket(id));
    if (statusError) throw new Error(statusError);
  });

  if (!loading && !overview) {
    return <SafeAreaView style={styles.safe}><View style={styles.locked}>
      <Ionicons name="lock-closed" size={40} color={colors.textDim} />
      <Text style={styles.lockedText}>{t("This console is for the IronFlow staff team.")}</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Affordance accessibilityRole="button" onPress={leave} style={styles.primary}><Text style={styles.primaryText}>{t("SIGN OUT")}</Text></Affordance>
    </View></SafeAreaView>;
  }

  const suspendDisabled = working || reason.trim().length < (selected?.suspended_at ? 5 : 10);
  const shownReports = reports.filter(row => reportType === "all" || row.target_type === reportType);
  const reportTypes = reports.map(row => row.target_type).filter(isReportTargetType).filter((type, index, all) => all.indexOf(type) === index);
  const visibleTickets = (tickets ?? []).filter(ticket => !unassignedOnly || ticket.assignee_id == null);
  const activityHint = t("Counts in the last 24 hours.");
  const stockHint = t("Active communities on the platform (not a 24h count).");
  return (
    <SafeAreaView style={styles.safe} testID="admin-console">
      <View style={styles.header}>
        <Affordance accessibilityRole="button" accessibilityLabel={t("SIGN OUT")} hitSlop={8} onPress={leave} style={styles.icon}><Ionicons name="log-out-outline" size={20} color={colors.text} /></Affordance>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t("STAFF CONSOLE")}</Text>
          <Text style={styles.headerMeta}>{user?.email} · {t((overview?.staff_role || "").toUpperCase() || "STAFF")}</Text>
        </View>
        {working ? <ActivityIndicator color={colors.text} /> : null}
      </View>

      <View style={styles.tabs}>
        {NAV.filter(item => {
          if (item.id === "analytics") return can("analytics.read");
          if (item.id === "accounting") return can("accounting.read");
          if (item.id === "support") return can("tickets.read");
          return true;
        }).map(item => {
          const count = item.id === "reports" ? overview?.queues.open_reports
            : item.id === "coaches" ? overview?.queues.pending_coach_applications
            : item.id === "joins" ? overview?.queues.pending_memberships
            : item.id === "support" ? overview?.queues.open_tickets
            : 0;
          return (
            <Affordance key={item.id} accessibilityRole="button" testID={`admin-tab-${item.id}`} onPress={() => { if (tab === "support" && item.id !== "support") setTicketDetail(null); setTab(item.id); }} style={[styles.tab, tab === item.id && styles.tabActive]}>
              <Ionicons name={item.icon} size={16} color={tab === item.id ? colors.text : colors.textMuted} />
              <Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{t(item.label)}</Text>
              {count ? <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View> : null}
            </Affordance>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.text} /> : null}
        {error ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.error}>{error}</Text><Affordance accessibilityRole="button" onPress={() => { setTicketReload(value => value + 1); void load(); }}><Text style={styles.retry}>{t("Retry")}</Text></Affordance></View> : null}

        {tab === "overview" && overview ? <>
          <Text style={styles.section}>{t("QUEUES")}</Text>
          <View style={styles.grid}>
            {([
              ["open_reports", "Open reports", "reports", "Platform moderation queue (not community-local)."],
              ["pending_coach_applications", "Coach applications", "coaches", ""],
              ["pending_memberships", "Join requests", "joins", "Memberships waiting for approval across all communities."],
            ] as const).map(([key, label, destination, hint]) => (
              <HintedMetric
                key={key}
                testID={`admin-queue-${key}`}
                value={formatNumber(overview.queues[key])}
                label={t(label)}
                hint={hint ? t(hint) : undefined}
                onPress={() => { if (destination === "coaches") { setCoachDirectory(null); setCoachFilter("pending"); } setTab(destination); }}
              />
            ))}
            {can("tickets.read") ? ([
              ["open_tickets", "Needs reply", "open"],
              ["pending_tickets", "Waiting on member", "pending"],
            ] as const).map(([key, label, nextStatus]) => (
              <HintedMetric
                key={key}
                testID={`admin-queue-${key}`}
                value={formatNumber(overview.queues[key] ?? 0)}
                label={t(label)}
                onPress={() => { setTicketStatus(nextStatus); setTicketDetail(null); setTab("support"); }}
              />
            )) : null}
          </View>
          <Text style={styles.section}>{t("MEMBERS")}</Text>
          <View style={styles.grid}>
            {([
              ["total", "Total", "all"],
              ["suspended", "Suspended", "suspended"],
            ] as const).map(([key, label, filter]) => (
              <Affordance key={key} accessibilityRole="button" onPress={() => { setStatus(filter); setTab("users"); void search(filter); }} style={styles.metric}>
                <Text style={styles.metricValue}>{formatNumber(overview.users[key])}</Text>
                <Text style={styles.metricLabel}>{t(label)}</Text>
              </Affordance>
            ))}
            <Affordance accessibilityRole="button" onPress={() => { setCoachDirectory(null); setCoachFilter("approved"); setTab("coaches"); }} style={styles.metric}>
              <Text style={styles.metricValue}>{formatNumber(overview.users.coaches)}</Text>
              <Text style={styles.metricLabel}>{t("Approved coaches")}</Text>
            </Affordance>
            <View style={styles.metric}><Text style={styles.metricValue}>{formatNumber(overview.users.new_7d)}</Text><Text style={styles.metricLabel}>{t("New (7 days)")}</Text></View>
          </View>
          <Text style={styles.section} testID="admin-section-stock">{t("STOCK")}</Text>
          <View style={styles.grid}>
            <HintedMetric testID="admin-stock-communities" value={formatNumber(overview.activity.communities)} label={t("Total communities")} hint={stockHint} onPress={() => setTab("communities")} />
          </View>
          <Text style={styles.section} testID="admin-section-activity">{t("LAST 24 HOURS")}</Text>
          <View style={styles.grid}>
            {([
              ["workouts_24h", "Workouts"],
              ["posts_24h", "Posts"],
              ["messages_24h", "Messages"],
            ] as const).map(([key, label]) => (
              <HintedMetric key={key} testID={`admin-activity-${key}`} value={formatNumber(overview.activity[key])} label={t(label)} hint={activityHint} />
            ))}
          </View>
          <Text style={styles.hint}>{t("Your permissions:")} {overview.permissions.join(", ")}</Text>
          <Text style={styles.hint}>{t("Health data (labs, biomarkers) and private messages are never shown in this console.")}</Text>
        </> : null}

        {tab === "reports" ? <>
          <View style={styles.filters}>
            {(["open", "resolved"] as const).map(item => (
              <Affordance key={item} accessibilityRole="button" accessibilityState={{ selected: reportStatus === item }} onPress={() => void loadReports(item)} style={[styles.chip, reportStatus === item && styles.chipActive]}>
                <Text style={[styles.chipText, reportStatus === item && styles.chipTextActive]}>{t(item === "open" ? "OPEN" : "RESOLVED")}</Text>
              </Affordance>
            ))}
          </View>
          {reportStatus === "resolved" ? <Text style={styles.hint}>{t("Resolved reports stay here so a decision can be checked later.")}</Text> : null}
          {reportTypes.length > 0 ? <View style={styles.filters}>
            <Affordance accessibilityRole="button" {...selectedControl(reportType === "all")} testID="report-type-all" onPress={() => setReportType("all")} style={[styles.chip, reportType === "all" && styles.chipActive]}>
              <Text style={[styles.chipText, reportType === "all" && styles.chipTextActive]}>{t("All types")}</Text>
            </Affordance>
            {reportTypes.map(type => (
              <Affordance key={type} accessibilityRole="button" {...selectedControl(reportType === type)} testID={`report-type-${type}`} onPress={() => setReportType(type)} style={[styles.chip, reportType === type && styles.chipActive]}>
                <Text style={[styles.chipText, reportType === type && styles.chipTextActive]}>{t(reportTypeLabel(type))}</Text>
              </Affordance>
            ))}
          </View> : null}
          {reports.length === 0 && !loading ? <Text style={styles.hint}>{t("The moderation queue is empty.")}</Text> : null}
          {reports.length > 0 && shownReports.length === 0 ? <Text style={styles.hint}>{t("Nothing in this list.")}</Text> : null}
          {shownReports.length ? <TextInput value={reason} onChangeText={setReason} maxLength={1000} placeholder={t("Decision note (stored in the audit log)")} placeholderTextColor={colors.textDim} style={styles.input} /> : null}
          {shownReports.map(report => (
            <View key={report.id} style={styles.card} testID={`report-${report.id}`}>
              <View style={styles.cardHead}>
                <Text style={styles.tag}>{t(report.reason.replace(/_/g, " ").toUpperCase())}</Text>
                <Text style={styles.time}>{formatDate(report.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
              </View>
              <Text style={styles.meta} testID={`report-age-${report.id}`}>{queueAge(report.created_at, report.reviewed_at, t)}</Text>
              <Text style={styles.meta}>{t("{type} by {name}", { type: t(isReportTargetType(report.target_type) ? reportTypeLabel(report.target_type) : report.target_type), name: report.reported_user?.full_name || report.reported_user?.email || t("Unknown") })}</Text>
              {report.content_snapshot ? <Text style={styles.snapshot}>“{report.content_snapshot}”</Text> : null}
              {report.detail ? <Text style={styles.meta}>{t("Reporter said:")} {report.detail}</Text> : null}
              {reportStatus === "resolved" && report.resolution ? <Text style={styles.meta}>{t(report.resolution.replace(/_/g, " ").toUpperCase())}</Text> : null}
              {reportStatus === "open" ? (can("reports.resolve") ? <View style={styles.actions}>
                {RESOLUTIONS.map(option => (
                  <Affordance key={option.key} accessibilityRole="button" testID={`resolve-${option.key}-${report.id}`} disabled={working} onPress={() => void resolve(report, option.key)} style={[styles.action, working && styles.disabled]}>
                    <Ionicons name={option.icon} size={15} color={option.key === "content_removed" ? colors.error : colors.text} />
                    <Text style={styles.actionText}>{t(option.label)}</Text>
                  </Affordance>
                ))}
              </View> : <Text style={styles.hint}>{t("Read-only: resolving reports needs the moderator role.")}</Text>) : null}
              {report.reported_user ? <Affordance accessibilityRole="button" onPress={() => void openUser(report.reported_user!.id)}><Text style={styles.link}>{t("Open account")}</Text></Affordance> : null}
            </View>
          ))}
        </> : null}

        {tab === "coaches" ? <>
          <View style={styles.filters}>
            {([
              ["pending", "Waiting list"],
              ["approved", "Approved coaches"],
              ["suspended", "Banned coaches"],
              ["rejected", "Rejected coaches"],
            ] as const).map(([item, label]) => (
              <Affordance key={item} accessibilityRole="button" accessibilityState={{ selected: coachFilter === item }} onPress={() => { setCoachDirectory(null); setCoachFilter(item); }} style={[styles.chip, coachFilter === item && styles.chipActive]}>
                <Text style={[styles.chipText, coachFilter === item && styles.chipTextActive]}>{t(label)}</Text>
              </Affordance>
            ))}
          </View>
          {coachFilter === "suspended" ? <Text style={styles.hint}>{t("A banned coach has a suspended account. Open the account to suspend or reinstate.")}</Text> : null}
          {coachDirectory === null && !error ? <ActivityIndicator color={colors.text} /> : null}
          {coachDirectory && coachFilter === "pending" && coachDirectory.length > 0 ? <TextInput value={reason} onChangeText={setReason} maxLength={500} placeholder={t("Review note (sent to the applicant)")} placeholderTextColor={colors.textDim} style={styles.input} /> : null}
          {coachDirectory && coachDirectory.length === 0 ? <Text style={styles.hint}>{t(coachFilter === "pending" ? "No coach applications waiting." : coachFilter === "approved" ? "No approved coaches." : coachFilter === "suspended" ? "No banned coaches." : "No rejected coaches.")}</Text> : null}
          {(coachDirectory || []).map(coach => (
            <View key={coach.application_id || coach.user_id} style={styles.card} testID={`application-${coach.application_id || coach.user_id}`}>
              <View style={styles.cardHead}>
                <Text style={styles.tag}>{t(coachFilter === "pending" ? "COACH APPLICATION" : coachFilter === "approved" ? "Approved coaches" : coachFilter === "suspended" ? "Banned coaches" : "Rejected coaches")}</Text>
                {coach.created_at ? <Text style={styles.time}>{formatDate(coach.created_at, { day: "numeric", month: "short" })}</Text> : null}
              </View>
              <Text style={styles.name}>{coach.full_name || coach.email || t("Unknown")}</Text>
              <Text style={styles.meta}>{coach.email}</Text>
              {coach.suspended_at ? <Text style={styles.suspendedNote}>{t("SUSPENDED")}</Text> : null}
              {coach.bio ? <Text style={styles.snapshot}>{coach.bio}</Text> : null}
              {coach.specialties?.length ? <Text style={styles.meta}>{t("SPECIALTIES")}: {coach.specialties.join(", ")}</Text> : null}
              {coach.credentials?.length ? <Text style={styles.meta}>{t("CREDENTIALS · ONE PER LINE")}: {coach.credentials.join(", ")}</Text> : null}
              {coach.review_note ? <Text style={styles.meta}>{coach.review_note}</Text> : null}
              {!coach.application_id ? <Text style={styles.hint}>{t("No application on file.")}</Text> : null}
              {coachFilter === "pending" && coach.application_id ? (can("coaches.review") ? <View style={styles.actions}>
                <Affordance accessibilityRole="button" testID={`reject-application-${coach.application_id}`} disabled={working} onPress={() => void reviewApplication({ id: coach.application_id!, user_id: coach.user_id } as CoachApplicationReview, "rejected")} style={[styles.action, working && styles.disabled]}>
                  <Ionicons name="close" size={15} color={colors.error} />
                  <Text style={styles.actionText}>{t("Reject")}</Text>
                </Affordance>
                <Affordance accessibilityRole="button" testID={`approve-application-${coach.application_id}`} disabled={working} onPress={() => void reviewApplication({ id: coach.application_id!, user_id: coach.user_id } as CoachApplicationReview, "approved")} style={[styles.action, working && styles.disabled]}>
                  <Ionicons name="checkmark" size={15} color={colors.text} />
                  <Text style={styles.actionText}>{t("Approve")}</Text>
                </Affordance>
              </View> : <Text style={styles.hint}>{t("Read-only: reviewing coaches needs the admin role.")}</Text>) : null}
              <Affordance accessibilityRole="button" onPress={() => void openUser(coach.user_id)}><Text style={styles.link}>{t("Open account")}</Text></Affordance>
            </View>
          ))}
        </> : null}

        {tab === "users" ? <>
          <View style={styles.searchRow}>
            <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} maxLength={80} placeholder={t("Search by name, email or ID")} placeholderTextColor={colors.textDim} style={[styles.input, { flex: 1, marginBottom: 0 }]} testID="admin-user-search" />
            <Affordance accessibilityRole="button" accessibilityLabel={t("Search")} disabled={working} onPress={() => void search()} style={styles.searchBtn}><Ionicons name="search" size={18} color={colors.text} /></Affordance>
          </View>
          <View style={styles.filters}>
            {(["all", "active", "suspended", "staff"] as Status[]).map(item => (
              <Affordance key={item} accessibilityRole="button" accessibilityState={{ selected: status === item }} onPress={() => { setStatus(item); void search(item); }} style={[styles.chip, status === item && styles.chipActive]}>
                <Text style={[styles.chipText, status === item && styles.chipTextActive]}>{t(item.toUpperCase())}</Text>
              </Affordance>
            ))}
          </View>
          {users.map(account => (
            <Affordance key={account.id} accessibilityRole="button" testID={`admin-user-${account.id}`} onPress={() => void openUser(account.id)} style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{account.full_name || account.email}</Text>
                <Text style={styles.meta}>{account.email}</Text>
              </View>
              {account.staff_role ? <View style={styles.staffTag}><Text style={styles.staffTagText}>{t(account.staff_role.toUpperCase())}</Text></View> : null}
              {account.gym_owner ? <View style={styles.staffTag} testID={`gym-owner-${account.id}`}><Text style={styles.staffTagText}>{t("GYM OWNER")}</Text></View> : null}
              {account.suspended_at ? <View style={styles.suspendedTag}><Text style={styles.suspendedTagText}>{t("SUSPENDED")}</Text></View> : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </Affordance>
          ))}
          {selected ? <View style={styles.card} testID="admin-user-detail">
            <Text style={styles.section}>{selected.full_name || selected.email}</Text>
            <Text style={styles.meta}>{selected.email} · {t(selected.role.toUpperCase())} · {t("Joined")} {formatDate(selected.created_at, { dateStyle: "medium" })}</Text>
            {selected.stats ? <View style={styles.grid}>
              {[["workouts", "Workouts"], ["posts", "Posts"], ["communities", "Communities"], ["reports_against", "Reports"]].map(([key, label]) => (
                <View key={key} style={styles.metric}><Text style={styles.metricValue}>{formatNumber(selected.stats![key as keyof typeof selected.stats] as number)}</Text><Text style={styles.metricLabel}>{t(label)}</Text></View>
              ))}
            </View> : null}
            {selected.suspended_at ? <Text style={styles.suspendedNote}>{t("Suspended:")} {selected.suspension_reason}</Text> : null}
            <TextInput value={reason} onChangeText={setReason} maxLength={500} placeholder={t("Reason (required, saved to the audit log)")} placeholderTextColor={colors.textDim} style={styles.input} testID="admin-reason" />
            <View style={styles.actions}>
              {can("users.suspend") ? <Affordance accessibilityRole="button" testID="admin-suspend" disabled={suspendDisabled} onPress={() => void suspend(selected)} style={[styles.action, suspendDisabled && styles.disabled]}>
                <Ionicons name={selected.suspended_at ? "lock-open-outline" : "lock-closed-outline"} size={15} color={selected.suspended_at ? colors.success : colors.error} />
                <Text style={styles.actionText}>{t(selected.suspended_at ? "REINSTATE" : "SUSPEND")}</Text>
              </Affordance> : null}
              {can("staff.manage") ? ([null, "support", "moderator", "admin"] as (StaffRole | null)[]).map(role => (
                <Affordance key={role ?? "none"} accessibilityRole="button" testID={`admin-role-${role ?? "none"}`} disabled={working || reason.trim().length < 5 || selected.staff_role === role} onPress={() => void setRole(selected, role)} style={[styles.action, (working || reason.trim().length < 5 || selected.staff_role === role) && styles.disabled]}>
                  <Text style={styles.actionText}>{t((role ?? "no staff").toUpperCase())}</Text>
                </Affordance>
              )) : null}
            </View>
            <Text style={styles.section}>{t("STAFF NOTES")}</Text>
            {selected.notes?.length
              ? selected.notes.map(note => <View key={note.id} style={styles.note}><Text style={styles.meta}>{note.author_email} · {formatDate(note.created_at, { dateStyle: "short" })}</Text><Text style={styles.noteText}>{note.note}</Text></View>)
              : <Text style={styles.hint}>{t("No notes on this account yet.")}</Text>}
            <TextInput value={note} onChangeText={setNote} maxLength={1000} placeholder={t("Add a note for the team")} placeholderTextColor={colors.textDim} style={styles.input} testID="admin-note" />
            <Affordance accessibilityRole="button" testID="admin-add-note" disabled={working || note.trim().length < 3} onPress={() => void addNote(selected)} style={[styles.action, (working || note.trim().length < 3) && styles.disabled]}>
              <Ionicons name="create-outline" size={15} color={colors.text} />
              <Text style={styles.actionText}>{t("Save note")}</Text>
            </Affordance>
          </View> : null}
        </> : null}

        {tab === "joins" ? <>
          <View style={styles.filters}>
            {MEMBERSHIP_STATUSES.map(item => (
              <Affordance key={item} accessibilityRole="button" {...selectedControl(joinStatus === item)} testID={`membership-filter-${item}`} onPress={() => setJoinStatus(item)} style={[styles.chip, joinStatus === item && styles.chipActive]}>
                <Text style={[styles.chipText, joinStatus === item && styles.chipTextActive]}>{t(membershipStatusLabel(item))}</Text>
              </Affordance>
            ))}
          </View>
          {joinStatus === "pending" ? <Text style={styles.hint} testID="membership-waiting-hint">{t("Accept or decline a waiting request. Paid communities still need verified billing.")}</Text> : null}
          {joinStatus === "pending" && joins.length ? <TextInput value={reason} onChangeText={setReason} maxLength={500} placeholder={t("Reason (required, saved to the audit log)")} placeholderTextColor={colors.textDim} style={styles.input} /> : null}
          {joins.length === 0 && !loading ? <Text style={styles.hint}>{t(joinStatus === "pending" ? "No join requests waiting." : "Nothing in this list.")}</Text> : null}
          {joins.map(row => (
            <View key={row.id} style={styles.card} testID={`admin-join-${row.id}`}>
              <Text style={styles.name}>{row.user?.full_name || row.user?.email || t("Unknown")}</Text>
              <Text style={styles.meta}>{row.user?.email}</Text>
              <Text style={styles.meta}>{row.community?.name || t("Unknown")} · {formatDate(row.created_at, { day: "numeric", month: "short" })}</Text>
              {joinStatus === "pending" ? (can("content.moderate") ? <View style={styles.actions}>
                <Affordance accessibilityRole="button" disabled={working || reason.trim().length < 5} onPress={() => void decideJoin(row, "rejected")} style={[styles.action, (working || reason.trim().length < 5) && styles.disabled]}>
                  <Ionicons name="close" size={15} color={colors.error} />
                  <Text style={styles.actionText}>{t("Reject")}</Text>
                </Affordance>
                <Affordance accessibilityRole="button" disabled={working || reason.trim().length < 5} onPress={() => void decideJoin(row, "active")} style={[styles.action, (working || reason.trim().length < 5) && styles.disabled]}>
                  <Ionicons name="checkmark" size={15} color={colors.text} />
                  <Text style={styles.actionText}>{t("Approve")}</Text>
                </Affordance>
              </View> : <Text style={styles.hint}>{t("Read-only: reviewing requests needs the moderator role.")}</Text>) : null}
              <View style={styles.actions}>
                <Affordance accessibilityRole="button" onPress={() => void openUser(row.user_id)} style={styles.action}><Text style={styles.actionText}>{t("Open account")}</Text></Affordance>
                {row.community ? <Affordance accessibilityRole="button" onPress={() => openMemberCommunity(row.community_id)} style={styles.action}><Text style={styles.actionText}>{t("OPEN COMMUNITY")}</Text></Affordance> : null}
              </View>
            </View>
          ))}
        </> : null}

        {tab === "communities" ? <>
          {communities.length === 0 && !loading ? <Text style={styles.hint}>{t("No communities yet")}</Text> : null}
          {communities.map(group => (
            <Affordance key={group.id} accessibilityRole="button" accessibilityHint={t("Active members only")} {...(Platform.OS === "web" ? { title: t("Active members only") } : {})} testID={`admin-community-${group.id}`} onPress={() => openMemberCommunity(group.id)} style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{group.name}</Text>
                <Text style={styles.meta}>{group.owner?.full_name || group.owner?.email || t("Unknown")} · {t(group.status.toUpperCase())} · {t("{n} members", { n: formatNumber(group.member_count) })}{group.pending_count ? ` · ${t("{n} waiting to join", { n: formatNumber(group.pending_count) })}` : ""}</Text>
                <Text style={styles.metricHint}>{t("Active members only")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </Affordance>
          ))}
        </> : null}

        {tab === "team" ? <>
          {team.length === 0 && !loading ? <Text style={styles.hint}>{t("No staff yet. Open a member and assign Support, Moderator or Admin.")}</Text> : null}
          <Affordance accessibilityRole="button" onPress={() => setTab("users")} style={styles.action}><Text style={styles.actionText}>{t("HIRE")}</Text></Affordance>
          {team.map(account => (
            <Affordance key={account.id} accessibilityRole="button" onPress={() => { setTab("users"); void openUser(account.id); }} style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{account.full_name || account.email}</Text>
                <Text style={styles.meta}>{account.email}</Text>
              </View>
              {account.staff_role ? <View style={styles.staffTag}><Text style={styles.staffTagText}>{t(account.staff_role.toUpperCase())}</Text></View> : null}
            </Affordance>
          ))}
        </> : null}

        {tab === "support" && can("tickets.read") ? <>
          {ticketDetail ? <View testID="ticket-thread">
            <Affordance accessibilityRole="button" testID="ticket-back" onPress={() => setTicketDetail(null)} style={styles.action}>
              <Ionicons name="arrow-back" size={15} color={colors.text} />
              <Text style={styles.actionText}>{t("BACK TO QUEUE")}</Text>
            </Affordance>
            <View style={styles.card}>
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
                <View style={styles.filters}>
                  {TICKET_STATUSES.map(item => (
                    <Affordance key={item} accessibilityRole="button" {...selectedControl(draftStatus === item)} testID={`ticket-status-${item}`} onPress={() => setDraftStatus(item)} style={[styles.chip, draftStatus === item && styles.chipActive]}>
                      <Text style={[styles.chipText, draftStatus === item && styles.chipTextActive]}>{staffTicketStatusLabel(item, t)}</Text>
                    </Affordance>
                  ))}
                </View>
                <Affordance accessibilityRole="button" testID="ticket-save-status" disabled={working || draftStatus === ticketDetail.status} onPress={() => void saveTicketStatus()} style={[styles.action, (working || draftStatus === ticketDetail.status) && styles.disabled]}>
                  <Text style={styles.actionText}>{t("SAVE STATUS")}</Text>
                </Affordance>
                <Text style={styles.section}>{t("REPLY")}</Text>
                <TextInput value={reply} onChangeText={setReply} maxLength={5000} multiline placeholder={t("Reply to the member")} placeholderTextColor={colors.textDim} style={[styles.input, styles.replyInput]} testID="ticket-reply" />
                <Affordance accessibilityRole="button" testID="ticket-send-reply" disabled={working || reply.trim().length === 0} onPress={() => void sendReply()} style={[styles.action, (working || reply.trim().length === 0) && styles.disabled]}>
                  <Ionicons name="send-outline" size={15} color={colors.text} />
                  <Text style={styles.actionText}>{t("SEND REPLY")}</Text>
                </Affordance>
                <Text style={styles.hint}>{t("A reply marks the ticket pending so the member knows staff has answered.")}</Text>
              </> : <Text style={styles.hint}>{t("Read-only: replying to tickets needs the support role.")}</Text>}
            </View>
          </View> : <>
            <View style={styles.filters}>
              {TICKET_STATUSES.map(item => (
                <Affordance key={item} accessibilityRole="button" {...selectedControl(ticketStatus === item)} testID={`ticket-filter-${item}`} onPress={() => setTicketStatus(item)} style={[styles.chip, ticketStatus === item && styles.chipActive]}>
                  <Text style={[styles.chipText, ticketStatus === item && styles.chipTextActive]}>{staffTicketStatusLabel(item, t)}</Text>
                </Affordance>
              ))}
              <Affordance accessibilityRole="button" {...selectedControl(unassignedOnly)} testID="ticket-filter-unassigned" onPress={() => setUnassignedOnly(value => !value)} style={[styles.chip, unassignedOnly && styles.chipActive]}>
                <Text style={[styles.chipText, unassignedOnly && styles.chipTextActive]}>{t("Unassigned")}</Text>
              </Affordance>
            </View>
            <View style={styles.searchRow}>
              <TextInput value={ticketQuery} onChangeText={setTicketQuery} onSubmitEditing={() => setTicketSearch(ticketQuery.trim())} maxLength={80} placeholder={t("Search by subject, email, or ticket id")} placeholderTextColor={colors.textDim} style={[styles.input, { flex: 1, marginBottom: 0 }]} testID="admin-ticket-search" />
              <Affordance accessibilityRole="button" accessibilityLabel={t("Search")} disabled={working} onPress={() => setTicketSearch(ticketQuery.trim())} style={styles.searchBtn}><Ionicons name="search" size={18} color={colors.text} /></Affordance>
            </View>
            {!can("tickets.read") ? <Text style={styles.hint}>{t("Reading tickets needs the support role.")}</Text> : null}
            {tickets === null && !error ? <ActivityIndicator color={colors.text} /> : null}
            {can("tickets.read") && tickets && visibleTickets.length === 0 && !error ? <Text style={styles.hint}>{t(unassignedOnly && tickets.length > 0 ? "No unassigned tickets." : "The support queue is empty.")}</Text> : null}
            {visibleTickets.map(ticket => (
              <Affordance key={ticket.id} accessibilityRole="button" testID={`admin-ticket-${ticket.id}`} onPress={() => void openTicket(ticket.id)} style={styles.row}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name}>{ticket.subject}</Text>
                  <Text style={styles.meta}>{ticketLabel(ticket.user, ticket.user_id)} · {t(ticket.category.replace(/_/g, " ").toUpperCase())}</Text>
                  <Text style={styles.meta}>{queueAge(ticket.created_at, ticket.updated_at, t)}{ticket.assignee_id ? "" : ` · ${t("Unassigned")}`}</Text>
                </View>
                <View style={styles.staffTag}><Text style={styles.staffTagText}>{staffTicketStatusLabel(ticket.status, t)}</Text></View>
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </Affordance>
            ))}
          </>}
        </> : null}

        {tab === "analytics" && can("analytics.read") ? <AnalyticsPanel /> : null}
        {tab === "accounting" && can("accounting.read") ? <AccountingPanel /> : null}

        {tab === "audit" ? <>
          <Text style={styles.hint}>{t("Append-only record of every staff action.")}</Text>
          <TextInput value={auditQuery} onChangeText={setAuditQuery} maxLength={80} placeholder={t("Filter the journal")} placeholderTextColor={colors.textDim} style={styles.input} />
          {audit.filter(entry => {
            const haystack = `${entry.action} ${entry.actor_email || ""} ${entry.reason || ""} ${entry.target_type}`.toLowerCase();
            return haystack.includes(auditQuery.trim().toLowerCase());
          }).map(entry => (
            <View key={entry.id} style={styles.auditRow}>
              <Text style={styles.auditAction}>{entry.action}</Text>
              <Text style={styles.meta}>{entry.actor_email} → {entry.target_type}:{entry.target_id.slice(0, 8)}</Text>
              {entry.reason ? <Text style={styles.snapshot}>{entry.reason}</Text> : null}
              <Text style={styles.time}>{formatDate(entry.created_at, { dateStyle: "short", timeStyle: "short" })}</Text>
            </View>
          ))}
          {audit.length === 0 && !loading ? <Text style={styles.hint}>{t("No staff actions recorded yet.")}</Text> : null}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function StaffHome() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }
  if (!user) return <Redirect href="/auth" />;
  return <AdminConsole />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.section, color: colors.text }, headerMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  tabs: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  tab: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  tabActive: { borderColor: colors.text, backgroundColor: colors.surface2 }, tabText: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 }, tabTextActive: { color: colors.text },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.text, fontSize: 10, fontWeight: "900" },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  section: { ...type.section, marginTop: spacing.lg }, hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { minWidth: 104, flexGrow: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] }, metricLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  metricHint: { color: colors.textDim, fontSize: 10, lineHeight: 14, marginTop: 4 },
  card: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, gap: 6, marginTop: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  tag: { color: colors.error, fontSize: 10, fontWeight: "900", letterSpacing: 1 }, time: { color: colors.textDim, fontSize: 11 },
  meta: { color: colors.textMuted, fontSize: 12, lineHeight: 17 }, snapshot: { color: colors.text, fontStyle: "italic", lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  action: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm },
  actionText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, disabled: { opacity: 0.4 },
  link: { color: colors.text, fontSize: 12, fontWeight: "800", marginTop: spacing.sm },
  input: { minHeight: 44, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, color: colors.text, marginBottom: spacing.sm },
  replyInput: { minHeight: 88, paddingVertical: spacing.sm, textAlignVertical: "top" },
  searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  searchBtn: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginVertical: spacing.sm },
  chip: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  chipActive: { borderColor: colors.text, backgroundColor: colors.surface2 }, chipText: { color: colors.textMuted, fontSize: 10, fontWeight: "900" }, chipTextActive: { color: colors.text },
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { color: colors.text, fontWeight: "800" },
  staffTag: { backgroundColor: colors.surface2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, flexShrink: 1 }, staffTagText: { color: colors.text, fontSize: 9, fontWeight: "900" },
  suspendedTag: { backgroundColor: colors.error, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }, suspendedTagText: { color: colors.text, fontSize: 9, fontWeight: "900" },
  suspendedNote: { color: colors.error, fontSize: 12, marginTop: 4 },
  note: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }, noteText: { color: colors.text, lineHeight: 19 },
  auditRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  auditAction: { color: colors.text, fontSize: 12, fontWeight: "900" },
  errorBox: { padding: spacing.md, borderWidth: 1, borderColor: colors.error, borderRadius: radius.sm, gap: 6 },
  error: { color: colors.error }, retry: { color: colors.text, fontWeight: "900" },
  locked: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  lockedText: { color: colors.textMuted, textAlign: "center" },
  primary: { minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.sm, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  primaryText: { ...type.button, fontSize: 12, color: colors.text },
});
