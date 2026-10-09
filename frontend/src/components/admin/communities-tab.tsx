import { Linking, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { staffColors } from "./staff-theme";
import { webOrigin } from "@/src/share";
import { consoleStyles as styles } from "./console-styles";
import { QueueList } from "./queue-list";
import { QueueRow } from "./queue-row";
import { StatusBadge } from "./status-badge";
import type { AdminConsoleModel } from "./use-admin-console";

function openMemberCommunity(id: string) {
  const origin = webOrigin();
  if (!origin) return;
  void Linking.openURL(`${origin}/community/${encodeURIComponent(id)}`);
}

export function CommunitiesTab({ model }: { model: AdminConsoleModel }) {
  const { t, formatDate, formatNumber, communities, communityTotal, communityCursor, loading, sectionErrors, updatedAt, working, moreCommunities, retrySection } = model;
  return (
    <QueueList
      t={t}
      formatDate={formatDate}
      error={sectionErrors.communities}
      onRetry={() => retrySection("communities")}
      retryLabel={t("Retry communities")}
      updatedAt={updatedAt.communities}
      empty={!loading && !sectionErrors.communities && communities.length === 0 ? t("No communities yet") : null}
      loaded={communities.length}
      total={communityTotal}
      nextCursor={communityCursor}
      onMore={() => void moreCommunities()}
      queueLabel={t("communities")}
      footerLoading={working}
    >
      {communities.map(group => {
        const status = group.status || "unknown";
        const tone = status === "active" ? "ok" : status === "suspended" || status === "banned" ? "danger" : "neutral";
        return (
          <QueueRow
            key={group.id}
            label={group.name}
            hint={t("Active members only")}
            testID={`admin-community-${group.id}`}
            onPress={() => openMemberCommunity(group.id)}
            trailing={<Ionicons name="chevron-forward" size={16} color={staffColors.textDim} />}
          >
            <View style={styles.cardHead}>
              <Text style={styles.name}>{group.name}</Text>
              <StatusBadge tone={tone} label={t(status.toUpperCase())} />
            </View>
            <Text style={styles.meta}>{group.owner?.full_name || group.owner?.email || t("Unknown")} · {typeof group.member_count === "number" ? t("{n} members", { n: formatNumber(group.member_count) }) : t("Member count not recorded")}{typeof group.pending_count === "number" && group.pending_count > 0 ? ` · ${t("{n} waiting to join", { n: formatNumber(group.pending_count) })}` : ""}</Text>
            <Text style={styles.metricHint}>{t("Active members only")}</Text>
          </QueueRow>
        );
      })}
    </QueueList>
  );
}
