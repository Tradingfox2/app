import { Text } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { consoleStyles as styles } from "./console-styles";
import { QueueList } from "./queue-list";
import { QueueRow } from "./queue-row";
import { StatusBadge } from "./status-badge";
import type { AdminConsoleModel } from "./use-admin-console";

export function StaffRolesTab({ model }: { model: AdminConsoleModel }) {
  const { t, formatDate, team, teamTotal, teamCursor, loading, sectionErrors, updatedAt, working, moreTeam, openUser, selectTab, retrySection } = model;
  return (
    <QueueList
      t={t}
      formatDate={formatDate}
      error={sectionErrors.team}
      onRetry={() => retrySection("team")}
      retryLabel={t("Retry staff roles")}
      updatedAt={updatedAt.team}
      empty={!loading && team.length === 0 ? t("No staff yet. Open a member and assign Support, Moderator or Admin.") : null}
      loaded={team.length}
      total={teamTotal}
      nextCursor={teamCursor}
      onMore={() => void moreTeam()}
      queueLabel={t("staff")}
      footerLoading={working}
    >
      <Affordance accessibilityRole="button" accessibilityLabel={t("HIRE")} onPress={() => selectTab("users")} style={styles.action}><Text style={styles.actionText}>{t("HIRE")}</Text></Affordance>
      {team.map(account => (
        <QueueRow key={account.id} label={account.full_name || account.email} onPress={() => { void openUser(account.id); }} trailing={account.staff_role ? <StatusBadge tone="info" label={t(account.staff_role.toUpperCase())} /> : null}>
          <Text style={styles.name}>{account.full_name || account.email}</Text>
          <Text style={styles.meta}>{account.email}</Text>
        </QueueRow>
      ))}
    </QueueList>
  );
}
