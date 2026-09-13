import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { AdminAccount, AdminOverview, api, AuditEntry, ModerationReport, StaffRole } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

type Tab = "overview" | "reports" | "users" | "audit";
type Status = "all" | "active" | "suspended" | "staff";

const RESOLUTIONS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "dismissed", label: "DISMISS", icon: "close-circle-outline" },
  { key: "warning_sent", label: "WARN", icon: "alert-circle-outline" },
  { key: "content_removed", label: "REMOVE", icon: "trash-outline" },
];

export default function AdminConsole() {
  const { user } = useAuth();
  const { t, formatDate, formatNumber } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [users, setUsers] = useState<AdminAccount[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
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
      const [reportRows, userRows, auditRows] = await Promise.all([
        summary.permissions.includes("reports.read") ? api.adminReports("open") : Promise.resolve([]),
        api.adminUsers("", "all"),
        summary.permissions.includes("audit.read") ? api.adminAuditLog() : Promise.resolve([]),
      ]);
      if (current !== revision.current) return;
      setReports(reportRows); setUsers(userRows.users); setAudit(auditRows);
    } catch (cause) {
      if (current === revision.current) setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [t]);

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
  const search = () => act(async () => { setUsers((await api.adminUsers(query, status)).users); });
  const openUser = (id: string) => act(async () => { setSelected(await api.adminUser(id)); setReason(""); });
  const resolve = (report: ModerationReport, resolution: string) => act(async () => {
    await api.adminReviewReport(report.id, resolution, reason.trim());
    setReports(rows => rows.filter(row => row.id !== report.id)); setReason("");
    setAudit(await api.adminAuditLog());
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

  if (!loading && !overview) {
    return <SafeAreaView style={styles.safe}><View style={styles.locked}>
      <Ionicons name="lock-closed" size={40} color={colors.textDim} />
      <Text style={styles.lockedText}>{t("This console is for the IronFlow staff team.")}</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.primary}><Text style={styles.primaryText}>{t("BACK")}</Text></Pressable>
    </View></SafeAreaView>;
  }

  const suspendDisabled = working || reason.trim().length < (selected?.suspended_at ? 5 : 10);
  return (
    <SafeAreaView style={styles.safe} testID="admin-console">
      <View style={styles.header}>
        <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t("STAFF CONSOLE")}</Text>
          <Text style={styles.headerMeta}>{user?.email} · {t((overview?.staff_role || "").toUpperCase() || "STAFF")}</Text>
        </View>
        {working ? <ActivityIndicator color={colors.brand} /> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {(["overview", "reports", "users", "audit"] as Tab[]).map(item => (
          <Pressable key={item} testID={`admin-tab-${item}`} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}>
            <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{t(item.toUpperCase())}</Text>
            {item === "reports" && reports.length ? <View style={styles.badge}><Text style={styles.badgeText}>{reports.length}</Text></View> : null}
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.brand} /> : null}
        {error ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.retry}>{t("Retry")}</Text></Pressable></View> : null}

        {tab === "overview" && overview ? <>
          <Text style={styles.section}>{t("QUEUES")}</Text>
          <View style={styles.grid}>
            {[["open_reports", "Open reports"], ["pending_coach_applications", "Coach applications"], ["pending_memberships", "Join requests"]].map(([key, label]) => (
              <View key={key} style={styles.metric}><Text style={styles.metricValue}>{formatNumber(overview.queues[key as keyof typeof overview.queues])}</Text><Text style={styles.metricLabel}>{t(label)}</Text></View>
            ))}
          </View>
          <Text style={styles.section}>{t("MEMBERS")}</Text>
          <View style={styles.grid}>
            {[["total", "Total"], ["new_7d", "New (7 days)"], ["suspended", "Suspended"], ["coaches", "Approved coaches"]].map(([key, label]) => (
              <View key={key} style={styles.metric}><Text style={styles.metricValue}>{formatNumber(overview.users[key as keyof typeof overview.users])}</Text><Text style={styles.metricLabel}>{t(label)}</Text></View>
            ))}
          </View>
          <Text style={styles.section}>{t("LAST 24 HOURS")}</Text>
          <View style={styles.grid}>
            {[["workouts_24h", "Workouts"], ["posts_24h", "Posts"], ["messages_24h", "Messages"], ["communities", "Communities"]].map(([key, label]) => (
              <View key={key} style={styles.metric}><Text style={styles.metricValue}>{formatNumber(overview.activity[key as keyof typeof overview.activity])}</Text><Text style={styles.metricLabel}>{t(label)}</Text></View>
            ))}
          </View>
          <Text style={styles.hint}>{t("Your permissions:")} {overview.permissions.join(", ")}</Text>
          <Text style={styles.hint}>{t("Health data (labs, biomarkers) and private messages are never shown in this console.")}</Text>
        </> : null}

        {tab === "reports" ? <>
          {reports.length === 0 && !loading ? <Text style={styles.hint}>{t("The moderation queue is empty.")}</Text> : null}
          {reports.length ? <TextInput value={reason} onChangeText={setReason} maxLength={1000} placeholder={t("Decision note (stored in the audit log)")} placeholderTextColor={colors.textDim} style={styles.input} /> : null}
          {reports.map(report => (
            <View key={report.id} style={styles.card} testID={`report-${report.id}`}>
              <View style={styles.cardHead}>
                <Text style={styles.tag}>{t(report.reason.replace(/_/g, " ").toUpperCase())}</Text>
                <Text style={styles.time}>{formatDate(report.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
              </View>
              <Text style={styles.meta}>{t("{type} by {name}", { type: t(report.target_type), name: report.reported_user?.full_name || report.reported_user?.email || t("Unknown") })}</Text>
              {report.content_snapshot ? <Text style={styles.snapshot}>“{report.content_snapshot}”</Text> : null}
              {report.detail ? <Text style={styles.meta}>{t("Reporter said:")} {report.detail}</Text> : null}
              {can("reports.resolve") ? <View style={styles.actions}>
                {RESOLUTIONS.map(option => (
                  <Pressable key={option.key} accessibilityRole="button" testID={`resolve-${option.key}-${report.id}`} disabled={working} onPress={() => void resolve(report, option.key)} style={[styles.action, working && styles.disabled]}>
                    <Ionicons name={option.icon} size={15} color={option.key === "content_removed" ? colors.error : colors.text} />
                    <Text style={styles.actionText}>{t(option.label)}</Text>
                  </Pressable>
                ))}
              </View> : <Text style={styles.hint}>{t("Read-only: resolving reports needs the moderator role.")}</Text>}
              {report.reported_user ? <Pressable accessibilityRole="button" onPress={() => void openUser(report.reported_user!.id)}><Text style={styles.link}>{t("Open account")}</Text></Pressable> : null}
            </View>
          ))}
        </> : null}

        {tab === "users" ? <>
          <View style={styles.searchRow}>
            <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} maxLength={80} placeholder={t("Search by name, email or ID")} placeholderTextColor={colors.textDim} style={[styles.input, { flex: 1, marginBottom: 0 }]} testID="admin-user-search" />
            <Pressable accessibilityRole="button" accessibilityLabel={t("Search")} disabled={working} onPress={() => void search()} style={styles.searchBtn}><Ionicons name="search" size={18} color={colors.brandOn} /></Pressable>
          </View>
          <View style={styles.filters}>
            {(["all", "active", "suspended", "staff"] as Status[]).map(item => (
              <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: status === item }} onPress={() => { setStatus(item); }} style={[styles.chip, status === item && styles.chipActive]}>
                <Text style={[styles.chipText, status === item && styles.chipTextActive]}>{t(item.toUpperCase())}</Text>
              </Pressable>
            ))}
          </View>
          {users.map(account => (
            <Pressable key={account.id} accessibilityRole="button" testID={`admin-user-${account.id}`} onPress={() => void openUser(account.id)} style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{account.full_name || account.email}</Text>
                <Text style={styles.meta}>{account.email}</Text>
              </View>
              {account.staff_role ? <View style={styles.staffTag}><Text style={styles.staffTagText}>{t(account.staff_role.toUpperCase())}</Text></View> : null}
              {account.suspended_at ? <View style={styles.suspendedTag}><Text style={styles.suspendedTagText}>{t("SUSPENDED")}</Text></View> : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </Pressable>
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
              {can("users.suspend") ? <Pressable accessibilityRole="button" testID="admin-suspend" disabled={suspendDisabled} onPress={() => void suspend(selected)} style={[styles.action, suspendDisabled && styles.disabled]}>
                <Ionicons name={selected.suspended_at ? "lock-open-outline" : "lock-closed-outline"} size={15} color={selected.suspended_at ? colors.success : colors.error} />
                <Text style={styles.actionText}>{t(selected.suspended_at ? "REINSTATE" : "SUSPEND")}</Text>
              </Pressable> : null}
              {can("staff.manage") ? ([null, "support", "moderator", "admin"] as (StaffRole | null)[]).map(role => (
                <Pressable key={role ?? "none"} accessibilityRole="button" testID={`admin-role-${role ?? "none"}`} disabled={working || reason.trim().length < 5 || selected.staff_role === role} onPress={() => void setRole(selected, role)} style={[styles.action, (working || reason.trim().length < 5 || selected.staff_role === role) && styles.disabled]}>
                  <Text style={styles.actionText}>{t((role ?? "no staff").toUpperCase())}</Text>
                </Pressable>
              )) : null}
            </View>
            {selected.notes?.length ? <>
              <Text style={styles.section}>{t("STAFF NOTES")}</Text>
              {selected.notes.map(note => <View key={note.id} style={styles.note}><Text style={styles.meta}>{note.author_email} · {formatDate(note.created_at, { dateStyle: "short" })}</Text><Text style={styles.noteText}>{note.note}</Text></View>)}
            </> : null}
          </View> : null}
        </> : null}

        {tab === "audit" ? <>
          <Text style={styles.hint}>{t("Append-only record of every staff action.")}</Text>
          {audit.map(entry => (
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.section, color: colors.text }, headerMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  tabs: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  tab: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.brand }, tabText: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 1 }, tabTextActive: { color: colors.text },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.text, fontSize: 10, fontWeight: "900" },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  section: { ...type.section, marginTop: spacing.lg }, hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { minWidth: 104, flexGrow: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] }, metricLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  card: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, gap: 6, marginTop: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  tag: { color: colors.error, fontSize: 10, fontWeight: "900", letterSpacing: 1 }, time: { color: colors.textDim, fontSize: 11 },
  meta: { color: colors.textMuted, fontSize: 12, lineHeight: 17 }, snapshot: { color: colors.text, fontStyle: "italic", lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  action: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm },
  actionText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, disabled: { opacity: 0.4 },
  link: { color: colors.brand, fontSize: 12, fontWeight: "800", marginTop: spacing.sm },
  input: { minHeight: 44, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, color: colors.text, marginBottom: spacing.sm },
  searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  searchBtn: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginVertical: spacing.sm },
  chip: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.brandDim }, chipText: { color: colors.textMuted, fontSize: 10, fontWeight: "900" }, chipTextActive: { color: colors.brand },
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { color: colors.text, fontWeight: "800" },
  staffTag: { backgroundColor: colors.brandDim, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }, staffTagText: { color: colors.brand, fontSize: 9, fontWeight: "900" },
  suspendedTag: { backgroundColor: colors.error, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }, suspendedTagText: { color: colors.text, fontSize: 9, fontWeight: "900" },
  suspendedNote: { color: colors.error, fontSize: 12, marginTop: 4 },
  note: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }, noteText: { color: colors.text, lineHeight: 19 },
  auditRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  auditAction: { color: colors.brand, fontSize: 12, fontWeight: "900" },
  errorBox: { padding: spacing.md, borderWidth: 1, borderColor: colors.error, borderRadius: radius.sm, gap: 6 },
  error: { color: colors.error }, retry: { color: colors.brand, fontWeight: "900" },
  locked: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  lockedText: { color: colors.textMuted, textAlign: "center" },
  primary: { minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  primaryText: { ...type.button, fontSize: 12 },
});
