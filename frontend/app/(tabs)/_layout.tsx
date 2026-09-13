import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";
import { ActivityIndicator, Platform, View } from "react-native";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} size="large" />
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
        tabBarItemStyle: { minHeight: 44 },
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
          tabBarIcon: ({ color }) => <Ionicons name="people" color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("You"),
          tabBarIcon: ({ color }) => <Ionicons name="person-circle" color={color} size={22} />,
        }}
      />
    </Tabs>
  );
}
