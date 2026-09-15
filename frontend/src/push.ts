/**
 * Phone push notifications (expo-notifications + Expo's free push service).
 *
 * Like realtime, push is an extra, never a requirement: on web, in Expo Go,
 * in a simulator, without permission or without an EAS project id, every
 * function here quietly does nothing and the in-app notification centre
 * carries on as before.
 *
 * `expo-notifications` is loaded lazily and only in a real build. Expo Go
 * removed remote push on Android in SDK 53, and merely importing the module
 * there logs an error at startup — found by running the app on an Android
 * emulator, which the web e2e suite cannot see.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { router } from "expo-router";
import { api } from "./api";

type NotificationsModule = typeof import("expo-notifications");

let registeredToken: string | null = null;
let module: NotificationsModule | null = null;
const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

/** True where remote push can work at all: a native build, not Expo Go. */
export function pushSupported(): boolean {
  return Platform.OS !== "web" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

function notifications(): NotificationsModule | null {
  if (!pushSupported()) return null;
  if (!module) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately lazy, see header
    module = require("expo-notifications") as NotificationsModule;
    // Show a banner even while the app is open: a DM or a live session
    // starting is worth interrupting for.
    module.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
    });
  }
  return module;
}

/** The EAS project id, from app config or the build environment. */
function projectId(): string | undefined {
  return (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
    ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
}

/** Ask for permission once signed in and register this device's token. */
export async function registerForPush(): Promise<string | null> {
  const Notifications = notifications();
  if (!Notifications) return null;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "IronFlow", importance: Notifications.AndroidImportance.DEFAULT });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return null;
    const id = projectId();
    const token = (await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined)).data;
    await api.registerPushToken(token, platform);
    registeredToken = token;
    return token;
  } catch {
    return null; // no project id, emulator without Play services, or offline
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
    const Notifications = signedIn ? notifications() : null;
    if (!Notifications) return;
    void registerForPush();
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      open((response.notification.request.content.data ?? {}) as Record<string, unknown>);
    });
    return () => subscription.remove();
  }, [signedIn]);
}
