import { useEffect, useState, type ComponentType } from "react";
import type { BottomTabBarButtonProps } from "expo-router/js-tabs";
import { Redirect, Tabs, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { pressableStyle, useReducedMotion } from "@/src/affordance";
import { colors } from "@/src/theme";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableProps,
} from "react-native";
import { useAuth } from "@/src/auth-context";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useShellScreenView } from "@/src/screen-view";

type AnchorPressableProps = PressableProps & { href?: string };

const AnchorPressable = Pressable as ComponentType<AnchorPressableProps>;

function isPlainActivation(event: GestureResponderEvent | { preventDefault?: () => void }): boolean {
  const click = event as GestureResponderEvent & {
    metaKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    button?: number;
    currentTarget?: { target?: string };
    preventDefault?: () => void;
  };
  const hasModifier = Boolean(click.metaKey || click.altKey || click.ctrlKey || click.shiftKey);
  const isLeft = click.button == null || click.button === 0;
  const target = click.currentTarget?.target;
  const isSelf = target == null || target === "" || target === "_self";
  return !hasModifier && isLeft && isSelf;
}

function TabBarButton({
  children,
  disabled,
  href,
  onPress,
  style,
  android_ripple,
  pressColor: _pressColor,
  pressOpacity: _pressOpacity,
  hoverEffect: _hoverEffect,
  ...rest
}: BottomTabBarButtonProps) {
  const reduceMotion = useReducedMotion();
  return (
    <AnchorPressable
      {...rest}
      disabled={disabled}
      href={href}
      android_ripple={
        disabled
          ? undefined
          : { borderless: true, ...android_ripple, color: "rgba(242, 243, 244, 0.14)" }
      }
      onPress={(event) => {
        if (Platform.OS === "web" && href != null) {
          if (!isPlainActivation(event)) return;
          event.preventDefault?.();
        }
        onPress?.(event);
      }}
      style={(state) => [
        style,
        pressableStyle(state, {
          variant: "quiet",
          reduceMotion,
          disabled: Boolean(disabled),
        }),
      ]}
    >
      {children}
    </AnchorPressable>
  );
}

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
          fontSize: 12,
          fontWeight: "700",
          letterSpacing: 0.2,
        },
        tabBarButton: (props) => <TabBarButton {...props} />,
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
          tabBarIcon: ({ color }) => <Ionicons name="barbell" color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: t("Community"),
          tabBarAccessibilityLabel: dmUnread
            ? t("Community, {count} unread messages", { count: badge(dmUnread) ?? dmUnread })
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
