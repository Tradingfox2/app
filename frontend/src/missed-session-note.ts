/**
 * Schedules the one weekly missed-session note.
 *
 * Expo's date trigger has no quiet-hours field, so the date is already inside
 * 08:00–20:59 local. iOS gets interruptionLevel passive. Android gets one
 * channel, `missed-session`, created at LOW. Importance cannot be changed
 * after the channel exists, so this file never passes another value.
 *
 * No background location. The plan and finished workouts are the only inputs.
 */
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import { loadNotifications, notificationApi } from "./notification-api";
import {
  MISSED_SESSION_CHANNEL_ID,
  decideMissedSessionNote,
  type MissedSessionCopy,
  type MissedSessionPlan,
} from "./missed-session";

const NOTE_KEY = "ironflow.missed-session-note";

let generation = 0;
let channelReady = false;

type NotificationsApi = typeof notificationApi;

function notifications(): NotificationsApi | null {
  if (!loadNotifications()) return null;
  return notificationApi;
}

async function cancelId(notificationsApi: NotificationsApi, identifier: string): Promise<void> {
  try {
    await notificationsApi.cancelScheduledNotificationAsync(identifier);
  } catch {
    // Already delivered, or this build has no native scheduler.
  }
}

/**
 * Create the channel once per process, always at LOW.
 * A later call with a different importance would not stick on Android.
 */
async function ensureChannel(notificationsApi: NotificationsApi, name: string): Promise<void> {
  if (Platform.OS !== "android" || channelReady) return;
  await notificationsApi.setNotificationChannelAsync(MISSED_SESSION_CHANNEL_ID, {
    name,
    importance: notificationsApi.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
    showBadge: false,
  });
  channelReady = true;
}

/** Drop a pending note. Used on sign-out so the next person does not inherit it. */
export async function cancelMissedSessionNote(): Promise<void> {
  generation += 1;
  const stored = await storage.getItem(NOTE_KEY, "");
  await storage.removeItem(NOTE_KEY);
  if (!stored) return;
  const api = notifications();
  if (!api) return;
  await cancelId(api, stored);
}

export async function syncMissedSessionNote(input: {
  programs: unknown;
  workouts: unknown;
  now: Date;
  userId: string;
  copy: MissedSessionCopy & { channelName: string };
}): Promise<void> {
  const ticket = ++generation;
  try {
    const api = notifications();
    if (!api) return;
    const stored = await storage.getItem(NOTE_KEY, "");
    if (ticket !== generation) return;
    const plan = decideMissedSessionNote({
      programs: input.programs,
      workouts: input.workouts,
      now: input.now,
      userId: input.userId,
      storedIdentifier: stored || null,
      copy: { title: input.copy.title, body: input.copy.body },
    });
    await applyPlan(api, plan, input.copy.channelName, ticket);
  } catch {
    // A missed reminder must not break Home.
  }
}

async function applyPlan(
  api: NotificationsApi,
  plan: MissedSessionPlan,
  channelName: string,
  ticket: number,
): Promise<void> {
  switch (plan.action) {
    case "none":
      return;
    case "cancel":
      // The week is finished, or the plan is gone. Drop the pending note.
      await storage.removeItem(NOTE_KEY);
      await cancelId(api, plan.identifier);
      return;
    case "schedule": {
      if (plan.cancelIdentifier) await cancelId(api, plan.cancelIdentifier);
      if (ticket !== generation) return;
      await ensureChannel(api, channelName);
      if (ticket !== generation) return;
      const current = await api.getPermissionsAsync();
      if (current.status !== "granted") return;
      if (ticket !== generation) return;
      const request = plan.request;
      const identifier = await api.scheduleNotificationAsync({
        identifier: request.identifier,
        content: request.content,
        trigger: {
          type: api.SchedulableTriggerInputTypes.DATE,
          date: request.trigger.date,
          channelId: request.trigger.channelId,
        },
      });
      if (ticket !== generation) {
        await cancelId(api, identifier);
        return;
      }
      await storage.setItem(NOTE_KEY, request.identifier);
      return;
    }
    default: {
      const unreachable: never = plan;
      void unreachable;
    }
  }
}
