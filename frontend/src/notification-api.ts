/**
 * Lazy access to the real `expo-notifications` module.
 *
 * The methods live on a plain object so a check can record arguments and then
 * call through to the same functions. Nothing here replaces a permission
 * result or a scheduled id. Importing the package at startup logs an error in
 * Expo Go, so the require stays inside the first call.
 */
import { Platform } from "react-native";

type NotificationsModule = typeof import("expo-notifications");

let loaded: NotificationsModule | null = null;

export function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === "web") return null;
  if (!loaded) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose, see header
    loaded = require("expo-notifications") as NotificationsModule;
    // A DM, a live session, or the end of a rest all show while the app is open.
    loaded.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
    });
  }
  return loaded;
}

function api(): NotificationsModule {
  const notifications = loadNotifications();
  if (!notifications) throw new Error("Notifications are unavailable");
  return notifications;
}

export const notificationApi = {
  getPermissionsAsync: (...args: Parameters<NotificationsModule["getPermissionsAsync"]>) => api().getPermissionsAsync(...args),
  requestPermissionsAsync: (...args: Parameters<NotificationsModule["requestPermissionsAsync"]>) => api().requestPermissionsAsync(...args),
  scheduleNotificationAsync: (...args: Parameters<NotificationsModule["scheduleNotificationAsync"]>) => api().scheduleNotificationAsync(...args),
  cancelScheduledNotificationAsync: (...args: Parameters<NotificationsModule["cancelScheduledNotificationAsync"]>) => api().cancelScheduledNotificationAsync(...args),
  setNotificationChannelAsync: (...args: Parameters<NotificationsModule["setNotificationChannelAsync"]>) => api().setNotificationChannelAsync(...args),
  getExpoPushTokenAsync: (...args: Parameters<NotificationsModule["getExpoPushTokenAsync"]>) => api().getExpoPushTokenAsync(...args),
  addNotificationResponseReceivedListener: (
    ...args: Parameters<NotificationsModule["addNotificationResponseReceivedListener"]>
  ) => api().addNotificationResponseReceivedListener(...args),
  get AndroidImportance() {
    return api().AndroidImportance;
  },
  get SchedulableTriggerInputTypes() {
    return api().SchedulableTriggerInputTypes;
  },
};
