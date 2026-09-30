import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, type NotificationPrefs } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { devicePushPermission, enableDevicePush, type DevicePushResult } from "@/src/push";
import { colors, spacing } from "@/src/theme";

/** Same order and keys as `notifications.CONFIGURABLE` on the server. */
const TYPES: [string, string][] = [
  ["follow", "New followers"],
  ["follow_request", "Follow requests"],
  ["follow_accepted", "Accepted follow requests"],
  ["post_like", "Likes on your posts"],
  ["post_comment", "Comments on your posts"],
  ["post_repost", "Reposts and quotes"],
  ["post_mention", "Mentions in posts and comments"],
  ["mention", "Mentions in community channels"],
  ["comment_reply", "Replies to your comments"],
  ["comment_like", "Likes on your comments"],
  ["direct_message", "Direct messages"],
  ["live_session", "Live sessions you signed up for"],
  ["program_adopted", "Members starting your programs"],
  ["join_request", "Join requests for your clubs"],
];

/**
 * What reaches the member. Switching a type off stops it both in the app and
 * on the phone. Moderation decisions and membership outcomes are not listed:
 * those always arrive.
 */
export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState("");
  const [pushHint, setPushHint] = useState("");
  const [pushBlocked, setPushBlocked] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    api.notificationPreferences().then(setPrefs).catch(cause => setError(cause instanceof Error ? cause.message : t("Something went wrong")));
  }, [t]);

  useEffect(() => {
    if (!prefs?.push) return;
    let cancelled = false;
    void devicePushPermission().then(state => {
      if (cancelled || state !== "blocked") return;
      setPushBlocked(true);
      setPushHint(t("Notifications are blocked for IronFlow. Enable them in Settings, then turn Push on again."));
    });
    return () => { cancelled = true; };
  }, [prefs?.push, t]);

  const update = async (change: { push?: boolean; types?: Record<string, boolean> }) => {
    if (!prefs) return;
    const previous = prefs;
    // Optimistic; the server's answer is the truth either way.
    setPrefs({ push: change.push ?? prefs.push, types: { ...prefs.types, ...(change.types ?? {}) } });
    try { setPrefs(await api.updateNotificationPreferences(change)); }
    catch (cause) { setPrefs(previous); setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
  };

  const onPush = async (value: boolean) => {
    if (!prefs || pushBusy) return;
    if (!value) {
      setPushHint("");
      setPushBlocked(false);
      await update({ push: false });
      return;
    }
    setPushBusy(true);
    setPushHint("");
    setPushBlocked(false);
    let result: DevicePushResult;
    try {
      result = await enableDevicePush();
    } catch {
      result = { status: "denied" };
    }
    setPushBusy(false);
    switch (result.status) {
      case "granted":
        if (!result.token) setPushHint(t("Push is allowed, but this build could not register a device token."));
        await update({ push: true });
        return;
      case "unsupported":
        setPushHint(t("Requires a native build (not Expo Go)"));
        await update({ push: true });
        return;
      case "denied":
        setPushHint(t("Push stays off until this phone allows notifications."));
        return;
      case "blocked":
        setPushHint(t("Notifications are blocked for IronFlow. Enable them in Settings, then turn Push on again."));
        setPushBlocked(true);
        return;
      default: {
        const exhaustive: never = result;
        setError(String(exhaustive));
      }
    }
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <Text style={styles.title}>{t("NOTIFICATION SETTINGS")}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.body}>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!prefs && !error ? <ActivityIndicator color={colors.brand} /> : null}
      {prefs ? <>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{t("Push notifications")}</Text>
            <Text style={styles.hint}>{t("Also send these to your phone.")}</Text>
            {pushHint ? <Text style={styles.hint} testID="pref-push-hint">{pushHint}</Text> : null}
            {pushBlocked ? <Pressable accessibilityRole="button" accessibilityLabel={t("OPEN SETTINGS")} onPress={() => void Linking.openSettings()} style={styles.settings} testID="pref-push-settings"><Text style={styles.settingsText}>{t("OPEN SETTINGS")}</Text></Pressable> : null}
          </View>
          <Switch testID="pref-push" accessibilityLabel={t("Push notifications")} disabled={pushBusy} value={prefs.push} onValueChange={value => void onPush(value)} trackColor={{ true: colors.brand }} />
        </View>
        <Text style={styles.section}>{t("TELL ME ABOUT")}</Text>
        {TYPES.map(([key, label]) => <View key={key} style={styles.row}>
          <Text style={[styles.label, { flex: 1 }]}>{t(label)}</Text>
          <Switch testID={`pref-${key}`} accessibilityLabel={t(label)} value={prefs.types[key] ?? true} onValueChange={value => void update({ types: { [key]: value } })} trackColor={{ true: colors.brand }} />
        </View>)}
        <Text style={styles.hint}>{t("Moderation decisions and membership outcomes always reach you.")}</Text>
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontWeight: "900", letterSpacing: 1 },
  body: { padding: spacing.lg, gap: spacing.xs },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { color: colors.text, fontSize: 14 },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  settings: { alignSelf: "flex-start", marginTop: spacing.xs },
  settingsText: { color: colors.brand, fontSize: 12, fontWeight: "800" },
  section: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginTop: spacing.lg },
  error: { color: colors.error },
});
