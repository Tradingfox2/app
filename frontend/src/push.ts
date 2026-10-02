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
import { loadNotifications, notificationApi } from "./notification-api";

let registeredToken: string | null = null;
const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

/** True where remote push can work at all: a native build, not Expo Go. */
export function pushSupported(): boolean {
  return Platform.OS !== "web" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

function notifications() {
  if (!pushSupported()) return null;
  if (!loadNotifications()) return null;
  return notificationApi;
}

/** Committed stand-in in app.json. `eas init` replaces it with the real project id. */
const EAS_PROJECT_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

/** The EAS project id, from app config or the build environment. */
function projectId(): string | undefined {
  const configured = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
    ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  const fromConfig = configured && configured !== EAS_PROJECT_PLACEHOLDER ? configured : undefined;
  return fromConfig ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
}

/**
 * Register this device's Expo token when notification permission is already
 * granted. Does not prompt. Undetermined and denied both return null; the
 * system dialog is `enableDevicePush` (Notification Settings).
 */
export async function registerForPush(): Promise<string | null> {
  const Notifications = notifications();
  if (!Notifications) return null;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "IronFlow", importance: Notifications.AndroidImportance.DEFAULT });
    }
    const { status } = await Notifications.getPermissionsAsync();
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

export type DevicePushResult =
  | { status: "granted"; token: string | null }
  | { status: "unsupported" }
  | { status: "denied" }
  | { status: "blocked" };

/**
 * Settings toggle: ask the OS, then register. `unsupported` is web or Expo Go,
 * where there is no system prompt. `blocked` means the user must open Settings.
 * A granted result with a null token means the OS allowed alerts but Expo's
 * push service did not return a token (no EAS project id, or an emulator).
 * `devicePushPermission` only reads the current OS state and does not prompt.
 */
export async function devicePushPermission(): Promise<"granted" | "denied" | "blocked" | "unsupported"> {
  const Notifications = notifications();
  if (!Notifications) return "unsupported";
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === "granted") return "granted";
    return current.canAskAgain === false ? "blocked" : "denied";
  } catch {
    return "denied";
  }
}

export async function enableDevicePush(): Promise<DevicePushResult> {
  const Notifications = notifications();
  if (!Notifications) return { status: "unsupported" };
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "IronFlow", importance: Notifications.AndroidImportance.DEFAULT });
    }
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    let canAskAgain = current.canAskAgain !== false;
    if (status !== "granted") {
      if (!canAskAgain) return { status: "blocked" };
      const next = await Notifications.requestPermissionsAsync();
      status = next.status;
      canAskAgain = next.canAskAgain !== false;
      if (status !== "granted") return { status: canAskAgain ? "denied" : "blocked" };
    }
  } catch {
    return { status: "denied" };
  }
  return { status: "granted", token: await registerForPush() };
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

/** Mount once inside the signed-in app: registers the token only if already allowed, routes taps. */
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
