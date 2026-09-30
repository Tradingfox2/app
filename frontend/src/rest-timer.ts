/**
 * Local notification for the workout rest countdown.
 *
 * The on-screen timer is a JS countdown and stops when the phone is locked.
 * Scheduling here is what still fires when the app is backgrounded. Permission
 * is never requested: Notification Settings is the only prompt. A denial, a
 * missing native scheduler, or web just skips the alert — the countdown stays.
 *
 * `expo-notifications` is required lazily. Importing it at startup in Expo Go
 * logs an error (same reason as `push.ts`).
 */
import { Platform } from "react-native";
import { loadNotifications, notificationApi } from "./notification-api";

export const DEFAULT_REST_SEC = 90;
/** Android channel id. The user-facing name is passed in (and translated) at schedule time. */
export const REST_TIMER_CHANNEL_ID = "rest-timer";
/** One id for the whole session so skip, finish, and unmount cancel the same alert. */
export const REST_NOTIFICATION_ID = "ironflow-rest-end";

let generation = 0;

function notifications() {
  if (!loadNotifications()) return null;
  return notificationApi;
}

/**
 * Rest length for the exercise on screen. Uses `rest_sec` when the payload
 * actually carries a positive number (program exercises do; the catalog does not).
 */
export function restSeconds(exercise: { rest_sec?: unknown } | null | undefined): number {
  const value = exercise && typeof exercise === "object" ? exercise.rest_sec : undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    const seconds = Math.round(value);
    if (seconds >= 1) return seconds;
  }
  return DEFAULT_REST_SEC;
}

export type RestNotificationCopy = {
  seconds: number;
  title: string;
  body: string;
  channelName: string;
};

/** Schedule the end-of-rest alert. Returns the notification id, or null if it could not be scheduled. */
export async function scheduleRestEndNotification(copy: RestNotificationCopy): Promise<string | null> {
  const ticket = ++generation;
  const Notifications = notifications();
  if (!Notifications) return null;
  const seconds = Math.max(1, Math.round(copy.seconds));
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(REST_TIMER_CHANNEL_ID, {
        name: copy.channelName,
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
      });
    }
    if (ticket !== generation) return null;
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== "granted") return null;
    if (ticket !== generation) return null;
    const identifier = await Notifications.scheduleNotificationAsync({
      identifier: REST_NOTIFICATION_ID,
      content: {
        title: copy.title,
        body: copy.body,
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        channelId: REST_TIMER_CHANNEL_ID,
      },
    });
    if (ticket !== generation) {
      await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
      return null;
    }
    return identifier;
  } catch {
    return null;
  }
}

/** Drop the pending end-of-rest alert. Safe when nothing was scheduled. */
export async function cancelRestEndNotification(): Promise<void> {
  generation += 1;
  const Notifications = notifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(REST_NOTIFICATION_ID);
  } catch {
    // Native scheduler missing, or no alert with this id.
  }
}
