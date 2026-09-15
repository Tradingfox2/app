/**
 * Phone push notifications (expo-notifications + Expo's free push service).
 *
 * Like realtime, push is an extra, never a requirement: on web, in a simulator,
 * without permission or without an EAS project id, every function here quietly
 * does nothing and the in-app notification centre carries on as before.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { api } from "./api";

let registeredToken: string | null = null;
const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

if (Platform.OS !== "web") {
  // Show a banner even while the app is open: a DM or a live session starting
  // is worth interrupting for.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

/** Ask for permission once signed in and register this device's token. */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "IronFlow", importance: Notifications.AndroidImportance.DEFAULT });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return null;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
      ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await api.registerPushToken(token, platform);
    registeredToken = token;
    return token;
  } catch {
    return null; // no project id, emulator, or offline: in-app notifications still work
  }
}

/** On sign-out: stop pushing the previous person's notifications to this phone. */
export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  try { await api.unregisterPushToken(registeredToken, platform); } catch { /* signing out regardless */ }
  registeredToken = null;
}

/** Where a tapped notification should land — the same routing as the centre. */
function open(data: Record<string, unknown>) {
  const target = typeof data.target_id === "string" ? data.target_id : null;
  if (typeof data.channel_id === "string") return router.push({ pathname: "/channel/[id]", params: { id: data.channel_id } });
  if (!target) return router.push("/notifications");
  switch (data.target_type) {
    case "post": return router.push({ pathname: "/post/[id]", params: { id: target } });
    case "user": return router.push({ pathname: "/user/[id]", params: { id: target } });
    case "dm": return router.push({ pathname: "/dm/[id]", params: { id: target } });
    case "community": return router.push({ pathname: "/community/[id]", params: { id: target } });
    default: return router.push("/notifications");
  }
}

/** Mount once inside the signed-in app: registers the device, routes taps. */
export function usePushNotifications(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn || Platform.OS === "web") return;
    void registerForPush();
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      open((response.notification.request.content.data ?? {}) as Record<string, unknown>);
    });
    return () => subscription.remove();
  }, [signedIn]);
}
