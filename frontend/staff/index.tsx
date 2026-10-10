import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { AccountingPanel } from "@/src/components/admin/accounting-panel";
import { AnalyticsPanel } from "@/src/components/admin/analytics-panel";
import { AuditTab } from "@/src/components/admin/audit-tab";
import { CoachesTab } from "@/src/components/admin/coaches-tab";
import { CommunitiesTab } from "@/src/components/admin/communities-tab";
import { consoleStyles as styles } from "@/src/components/admin/console-styles";
import { MembershipsTab } from "@/src/components/admin/memberships-tab";
import { NAV, NAV_GROUPS } from "@/src/components/admin/admin-labels";
import { OperationsOverview } from "@/src/components/admin/operations-overview";
import { ReportsTab } from "@/src/components/admin/reports-tab";
import { StaffRolesTab } from "@/src/components/admin/staff-roles-tab";
import { SupportTab } from "@/src/components/admin/support-tab";
import { useAdminConsole } from "@/src/components/admin/use-admin-console";
import { UsersTab } from "@/src/components/admin/users-tab";
import { staffColors, staffEnter, staffFonts, staffShadow } from "@/src/components/admin/staff-theme";
import { useStaffMotionSheet } from "@/src/components/admin/staff-motion";
import { selectedControl } from "@/src/community-copy";
import { useReducedMotion } from "@/src/press-feedback";
import { useAuth } from "@/src/auth-context";
import { spacing } from "@/src/theme";

const SIDEBAR_AT = 1080;

function queueCount(id: string, overview: { queues: { open_reports: number; pending_coach_applications: number; pending_memberships: number; open_tickets?: number } } | null): number {
  if (!overview) return 0;
  if (id === "reports") return overview.queues.open_reports;
  if (id === "coaches") return overview.queues.pending_coach_applications;
  if (id === "joins") return overview.queues.pending_memberships;
  if (id === "support") return overview.queues.open_tickets ?? 0;
  return 0;
}

function AdminConsole() {
  const model = useAdminConsole();
  const { width } = useWindowDimensions();
  const wide = width >= SIDEBAR_AT;
  const [navOpen, setNavOpen] = useState(false);
  const reduced = useReducedMotion();
  useStaffMotionSheet();
  const { user, logout, t, tab, selectTab, overview, health, sectionErrors, can, loading, error, working, reloadVisible, search } = model;
  const current = NAV.find(item => item.id === tab);

  const visible = (id: string) => {
    if (id === "analytics") return can("analytics.read");
    if (id === "accounting") return can("accounting.read");
    if (id === "support") return can("tickets.read");
    return true;
  };

  const navButtons = NAV_GROUPS.map(group => {
    const items = NAV.filter(item => group.ids.includes(item.id) && visible(item.id));
    if (items.length === 0) return null;
    return (
      <View key={group.id} style={shell.group} accessibilityRole="tablist">
        <Text style={shell.groupLabel}>{t(group.label)}</Text>
        {items.map(item => {
          const selected = tab === item.id;
          const count = queueCount(item.id, overview);
          return (
            <Affordance
              key={item.id}
              accessibilityRole="tab"
              accessibilityLabel={t(item.label)}
              {...selectedControl(selected)}
              testID={`admin-tab-${item.id}`}
              onPress={() => { setNavOpen(false); selectTab(item.id); }}
              style={[styles.tab, shell.sideTab, selected && styles.tabActive]}
            >
              <Ionicons name={item.icon} size={16} color={selected ? staffColors.brand : staffColors.textMuted} />
              <Text style={[styles.tabText, selected && styles.tabTextActive, shell.tabLabel]}>{t(item.label)}</Text>
              {count ? <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View> : null}
            </Affordance>
          );
        })}
      </View>
    );
  });

  if (!loading && !overview) {
    const signedInStaff = Boolean(user?.staff_role);
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.locked}>
          <Ionicons name={signedInStaff ? "cloud-offline-outline" : "lock-closed"} size={40} color={staffColors.textDim} />
          <Text style={styles.lockedText}>{t(signedInStaff ? "The operations summary could not be loaded." : "This console is for the IronFlow staff team.")}</Text>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {signedInStaff ? <Affordance accessibilityRole="button" accessibilityLabel={t("Retry")} onPress={reloadVisible}><Text style={styles.retry}>{t("Retry")}</Text></Affordance> : null}
          <Affordance accessibilityRole="button" accessibilityLabel={t("SIGN OUT")} onPress={() => { void logout(); }} style={styles.action}><Text style={styles.actionText}>{t("SIGN OUT")}</Text></Affordance>
        </View>
      </SafeAreaView>
    );
  }

  const identity = (
    <View style={shell.identity}>
      <Text style={styles.headerMeta} numberOfLines={1}>{user?.email}</Text>
      <Text style={shell.role}>{t((overview?.staff_role || "").toUpperCase() || "STAFF")}</Text>
      <Affordance accessibilityRole="button" accessibilityLabel={t("SIGN OUT")} hitSlop={8} onPress={() => { void logout(); }} style={shell.signOut}>
        <Ionicons name="log-out-outline" size={18} color={staffColors.text} />
        <Text style={shell.signOutText}>{t("SIGN OUT")}</Text>
      </Affordance>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} testID="admin-console">
      <LinearGradient colors={[staffColors.bgTint, staffColors.bg]} style={shell.wash} pointerEvents="none" />
      <View style={[shell.frame, wide && shell.frameWide]}>
        {wide ? (
          <View style={shell.sidebar}>
            <View style={styles.titleRow}>
              <Text style={styles.headerTitle} testID="admin-operations-title">{t("IRONFLOW / OPERATIONS")}</Text>
            </View>
            <View style={styles.workspace} testID="admin-workspace-badge"><Text style={styles.workspaceText}>{t("Admin workspace")}</Text></View>
            <ScrollView style={shell.navScroll} contentContainerStyle={shell.navContent}>{navButtons}</ScrollView>
            {identity}
          </View>
        ) : (
          <View style={styles.header}>
            <Affordance accessibilityRole="button" accessibilityLabel={t(navOpen ? "Close menu" : "Menu")} accessibilityState={{ expanded: navOpen }} aria-expanded={navOpen} testID="admin-nav-menu" hitSlop={8} onPress={() => setNavOpen(open => !open)} style={styles.icon}>
              <Ionicons name={navOpen ? "close" : "menu"} size={22} color={staffColors.text} />
            </Affordance>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.titleRow}>
                <Text style={styles.headerTitle} testID="admin-operations-title">{t("IRONFLOW / OPERATIONS")}</Text>
                <View style={styles.workspace} testID="admin-workspace-badge"><Text style={styles.workspaceText}>{t("Admin workspace")}</Text></View>
              </View>
              <Text style={styles.headerMeta} numberOfLines={1}>{user?.email} · {t((overview?.staff_role || "").toUpperCase() || "STAFF")}</Text>
            </View>
            <Affordance accessibilityRole="button" accessibilityLabel={t("SIGN OUT")} hitSlop={8} onPress={() => { void logout(); }} style={styles.icon}>
              <Ionicons name="log-out-outline" size={20} color={staffColors.text} />
            </Affordance>
          </View>
        )}
        <View style={shell.stage}>
        <View style={shell.main}>
          <View style={shell.pageHead}>
            <Text style={shell.pageTitle}>{current ? t(current.label) : ""}</Text>
            {working ? <ActivityIndicator color={staffColors.text} /> : null}
          </View>
          <ScrollView contentContainerStyle={styles.scroll} accessibilityElementsHidden={!wide && navOpen}>
            <View style={staffEnter(reduced)}>
              {loading ? <ActivityIndicator color={staffColors.text} /> : null}
              {error ? (
                <View accessibilityRole="alert" style={styles.errorBox}>
                  <Text style={styles.error}>{error}</Text>
                  <Affordance accessibilityRole="button" accessibilityLabel={t("Retry")} onPress={reloadVisible}><Text style={styles.retry}>{t("Retry")}</Text></Affordance>
                </View>
              ) : null}
              {tab === "overview" && overview ? (
                <OperationsOverview
                  overview={overview}
                  health={health}
                  sectionErrors={sectionErrors}
                  canReviewCoaches={can("coaches.review")}
                  t={t}
                  formatNumber={model.formatNumber}
                  formatDate={model.formatDate}
                  onOpenReports={() => { model.loadReports("open", "all"); selectTab("reports"); }}
                  onOpenTickets={nextStatus => { model.setUnassignedOnly(false); model.setTicketStatus(nextStatus); model.setTicketDetail(null); selectTab("support"); }}
                  onOpenUnassigned={() => { model.setUnassignedOnly(true); model.setTicketStatus("open"); model.setTicketDetail(null); selectTab("support"); }}
                  onOpenCoaches={() => { model.setCoachFilter("pending"); selectTab("coaches"); }}
                  onOpenJoins={() => { model.setJoinStatus("pending"); selectTab("joins"); }}
                  onOpenUsers={filter => { selectTab("users"); void search(filter); }}
                  onOpenCommunities={() => selectTab("communities")}
                />
              ) : null}
              {tab === "reports" ? <ReportsTab model={model} /> : null}
              {tab === "coaches" ? <CoachesTab model={model} /> : null}
              {tab === "users" ? <UsersTab model={model} /> : null}
              {tab === "joins" ? <MembershipsTab model={model} /> : null}
              {tab === "communities" ? <CommunitiesTab model={model} /> : null}
              {tab === "team" ? <StaffRolesTab model={model} /> : null}
              {tab === "support" ? <SupportTab model={model} /> : null}
              {tab === "analytics" && can("analytics.read") ? <AnalyticsPanel /> : null}
              {tab === "accounting" && can("accounting.read") ? <AccountingPanel /> : null}
              {tab === "audit" ? <AuditTab model={model} /> : null}
            </View>
          </ScrollView>
        </View>
        {!wide ? (
          <View pointerEvents={navOpen ? "auto" : "none"} style={[shell.drawer, !navOpen && shell.drawerClosed]} accessibilityElementsHidden={!navOpen}>
            <View style={shell.drawerPanel}>
              <ScrollView style={shell.drawerScroll} contentContainerStyle={shell.navContent}>{navButtons}</ScrollView>
            </View>
            {navOpen ? <Pressable accessibilityRole="button" accessibilityLabel={t("Close menu")} onPress={() => setNavOpen(false)} style={shell.backdrop} /> : null}
          </View>
        ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const shell = {
  wash: { position: "absolute" as const, top: 0, left: 0, right: 0, height: 220 },
  frame: { flex: 1, position: "relative" as const },
  frameWide: { flexDirection: "row" as const },
  sidebar: {
    width: 264,
    borderRightWidth: 1,
    borderRightColor: staffColors.border,
    backgroundColor: staffColors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    ...staffShadow,
  },
  navScroll: { flex: 1, marginTop: spacing.lg },
  navContent: { gap: spacing.md, paddingBottom: spacing.lg },
  group: { gap: 4 },
  groupLabel: {
    color: staffColors.textDim,
    fontFamily: staffFonts.text,
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 1.1,
    textTransform: "uppercase" as const,
    marginBottom: 4,
    marginLeft: 8,
  },
  sideTab: { alignSelf: "stretch" as const },
  tabLabel: { flexShrink: 1, textTransform: "uppercase" as const },
  identity: { borderTopWidth: 1, borderTopColor: staffColors.border, paddingTop: spacing.md, gap: 4 },
  role: { color: staffColors.text, fontFamily: staffFonts.display, fontSize: 16, letterSpacing: 0.8 },
  signOut: { minHeight: 40, flexDirection: "row" as const, alignItems: "center" as const, gap: 8, marginTop: 6 },
  signOutText: { color: staffColors.text, fontFamily: staffFonts.text, fontSize: 13, fontWeight: "600" as const },
  stage: { flex: 1, minWidth: 0, position: "relative" as const },
  main: { flex: 1, minWidth: 0 },
  drawer: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, zIndex: 30, flexDirection: "row" as const },
  drawerClosed: { display: "none" as const },
  drawerPanel: { width: 280, maxWidth: "86%" as const, alignSelf: "stretch" as const, overflow: "hidden" as const, backgroundColor: staffColors.surface, borderRightWidth: 1, borderRightColor: staffColors.border, padding: spacing.md, ...staffShadow },
  drawerScroll: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(16, 20, 24, 0.72)" },
  pageHead: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    borderBottomWidth: 1,
    borderBottomColor: staffColors.border,
  },
  pageTitle: { fontFamily: staffFonts.display, fontSize: 26, lineHeight: 30, color: staffColors.text, letterSpacing: 0.4, textTransform: "uppercase" as const },
};

export default function StaffHome() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={staffColors.text} />
      </SafeAreaView>
    );
  }
  if (!user) return <Redirect href="/auth" />;
  return <AdminConsole />;
}
