import { useEffect, useState } from "react";
import { Redirect, Tabs, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";
import { ActivityIndicator, Platform, View } from "react-native";
import { useAuth } from "@/src/auth-context";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useShellScreenView } from "@/src/screen-view";

function badge(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? "99+" : String(count);
}

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const pathname = usePathname();
  const [dmUnread, setDmUnread] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  useShellScreenView(!loading && !!user);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.dmUnreadCount().then((row) => { if (!cancelled) setDmUnread(row.count || 0); }).catch(() => undefined);
    api.unreadNotificationCount().then((row) => { if (!cancelled) setNotifUnread(row.count || 0); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [user, pathname]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.text} size="large" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/auth" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        // textMuted (not textDim): inactive tabs must stay readable on the dark bar
        tabBarInactiveTintColor: colors.textMuted,
        tabBarActiveBackgroundColor: "transparent",
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderStrong,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 84 : 68,
          paddingTop: 8,
          paddingBottom: Platform.OS === "ios" ? 28 : 10,
        },
        tabBarItemStyle: { minHeight: 44, minWidth: 44 },
        tabBarBadgeStyle: { backgroundColor: colors.text, color: colors.bg, fontSize: 10, fontWeight: "700" },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.2,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("Home"),
          tabBarIcon: ({ color }) => <Ionicons name="home" color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: t("Workout"),
          tabBarIcon: ({ color }) => <Ionicons name="add-circle" color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: t("Community"),
          tabBarAccessibilityLabel: dmUnread
            ? t("Community, {count} unread", { count: badge(dmUnread) ?? dmUnread })
            : t("Community"),
          tabBarBadge: badge(dmUnread),
          tabBarButtonTestID: "tab-community",
          tabBarIcon: ({ color }) => <Ionicons name="people" color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("You"),
          tabBarAccessibilityLabel: notifUnread
            ? t("You, {count} unread", { count: badge(notifUnread) ?? notifUnread })
            : t("You"),
          tabBarBadge: badge(notifUnread),
          tabBarButtonTestID: "tab-you",
          tabBarIcon: ({ color }) => <Ionicons name="person-circle" color={color} size={22} />,
        }}
      />
    </Tabs>
  );
}
