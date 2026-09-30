import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api, type LiveNowSession } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const REFRESH_MS = 20000;

/**
 * Sessions the signed-in member can join right now.
 * Renders nothing when the list is empty or the request fails.
 */
export function LiveNowStrip({ inset = false }: { inset?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [sessions, setSessions] = useState<LiveNowSession[]>([]);

  const load = useCallback(async () => {
    try {
      const rows = await api.liveNow();
      setSessions(rows.filter((row) => row.status === "live" && row.id));
    } catch {
      setSessions([]);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]));

  if (sessions.length === 0) return null;

  return (
    <View style={styles.wrap} testID="live-now-strip">
      <View style={[styles.head, inset && styles.inset]}>
        <View style={styles.dot} />
        <Text style={styles.label}>{t("LIVE")}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, inset && styles.inset]}
      >
        {sessions.map((session) => {
          const place = [session.community_name, session.channel_name ? `#${session.channel_name}` : ""]
            .filter(Boolean)
            .join(" · ");
          const meta = [place, session.host?.full_name].filter(Boolean).join(" · ");
          return (
            <Pressable
              key={session.id}
              accessibilityRole="button"
              accessibilityLabel={`${t("JOIN")} ${session.title}`}
              testID={`live-now-${session.id}`}
              onPress={() => router.push({ pathname: "/live/[id]", params: { id: session.id } })}
              style={styles.card}
            >
              <View style={styles.badge}>
                <View style={styles.dot} />
                <Text style={styles.badgeText}>{t("LIVE")}</Text>
              </View>
              <Text numberOfLines={1} style={styles.title}>{session.title}</Text>
              {meta ? <Text numberOfLines={1} style={styles.meta}>{meta}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, gap: spacing.sm, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  inset: { paddingHorizontal: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.live },
  label: { color: colors.live, fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  row: { gap: spacing.sm },
  card: {
    width: 220,
    minHeight: 88,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    justifyContent: "center",
  },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "transparent",
  },
  badgeText: { color: colors.live, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  title: { color: colors.text, fontSize: 15, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 12 },
});
