import { ActivityIndicator, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import { NAV } from "@/src/components/admin/admin-labels";
import { OperationsOverview } from "@/src/components/admin/operations-overview";
import { ReportsTab } from "@/src/components/admin/reports-tab";
import { StaffRolesTab } from "@/src/components/admin/staff-roles-tab";
import { SupportTab } from "@/src/components/admin/support-tab";
import { useAdminConsole } from "@/src/components/admin/use-admin-console";
import { UsersTab } from "@/src/components/admin/users-tab";
import { colors } from "@/src/theme";
import { useAuth } from "@/src/auth-context";

function AdminConsole() {
  const model = useAdminConsole();
  const { width } = useWindowDimensions();
  const narrow = width < 720;
  const { user, logout, t, tab, selectTab, overview, health, sectionErrors, can, loading, error, working, reloadVisible, search } = model;

  if (!loading && !overview) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.locked}>
          <Ionicons name="lock-closed" size={40} color={colors.textDim} />
          <Text style={styles.lockedText}>{t("This console is for the IronFlow staff team.")}</Text>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Affordance accessibilityRole="button" accessibilityLabel={t("SIGN OUT")} onPress={() => { void logout(); }} style={styles.primary}><Text style={styles.primaryText}>{t("SIGN OUT")}</Text></Affordance>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} testID="admin-console">
      <View style={[styles.header, narrow && styles.headerNarrow]}>
        <Affordance accessibilityRole="button" accessibilityLabel={t("SIGN OUT")} hitSlop={8} onPress={() => { void logout(); }} style={styles.icon}><Ionicons name="log-out-outline" size={20} color={colors.text} /></Affordance>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.titleRow}>
            <Text style={styles.headerTitle} testID="admin-operations-title">{t("IRONFLOW / OPERATIONS")}</Text>
            <View style={styles.workspace} testID="admin-workspace-badge"><Text style={styles.workspaceText}>{t("Admin workspace")}</Text></View>
          </View>
          <Text style={styles.headerMeta}>{user?.email} · {t((overview?.staff_role || "").toUpperCase() || "STAFF")}</Text>
        </View>
        {working ? <ActivityIndicator color={colors.text} /> : null}
      </View>

      <View accessibilityRole="tablist" style={styles.tabs}>
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
            <Affordance key={item.id} accessibilityRole="button" accessibilityLabel={t(item.label)} accessibilityState={{ selected: tab === item.id }} testID={`admin-tab-${item.id}`} onPress={() => selectTab(item.id)} style={[styles.tab, tab === item.id && styles.tabActive]}>
              <Ionicons name={item.icon} size={16} color={tab === item.id ? colors.brand : colors.textMuted} />
              <Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{t(item.label)}</Text>
              {count ? <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View> : null}
            </Affordance>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.text} /> : null}
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
