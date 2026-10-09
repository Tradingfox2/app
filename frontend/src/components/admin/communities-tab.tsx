import { Linking, Platform, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Affordance } from "@/src/press-affordance";
import { colors } from "@/src/theme";
import { webOrigin } from "@/src/share";
import { consoleStyles as styles } from "./console-styles";
import { QueueList } from "./queue-list";
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
      {communities.map(group => (
        <Affordance key={group.id} accessibilityRole="button" accessibilityLabel={group.name} accessibilityHint={t("Active members only")} {...(Platform.OS === "web" ? { title: t("Active members only") } : {})} testID={`admin-community-${group.id}`} onPress={() => openMemberCommunity(group.id)} style={styles.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name}>{group.name}</Text>
            <Text style={styles.meta}>{group.owner?.full_name || group.owner?.email || t("Unknown")} · {t(group.status.toUpperCase())} · {t("{n} members", { n: formatNumber(group.member_count) })}{group.pending_count ? ` · ${t("{n} waiting to join", { n: formatNumber(group.pending_count) })}` : ""}</Text>
            <Text style={styles.metricHint}>{t("Active members only")}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
        </Affordance>
      ))}
    </QueueList>
  );
}
