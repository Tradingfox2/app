/**
 * Runs against the real `expo-notifications` functions.
 *
 * A recorder wraps schedule, cancel, channel, and requestPermissions only to
 * remember the arguments, then calls the original export. It does not invent
 * a permission status or a notification id. On this machine the native
 * scheduler is absent, so the real schedule/cancel/android-channel calls throw
 * UnavailabilityError — that error is part of the assertion.
 *
 * The runner loads this file in Node (no DOM → the real permission module
 * returns denied) and in Firefox (real Notification.permission, default and
 * granted). `pushSupported()` has to be true, so the browser bundle sets
 * EXPO_OS to ios; that is the OS value, not a fake permission.
 */
import { Platform } from "expo-modules-core";
import { parseTrigger } from "expo-notifications/build/scheduleNotificationAsync.js";
import { setNotificationChannelAsync as setAndroidChannel } from "expo-notifications/build/setNotificationChannelAsync.android.js";
import { notificationApi } from "./notification-api";
import { enableDevicePush, pushSupported, registerForPush } from "./push";
import {
  DEFAULT_REST_SEC,
  REST_NOTIFICATION_ID,
  REST_TIMER_CHANNEL_ID,
  cancelRestEndNotification,
  restSeconds,
  scheduleRestEndNotification,
} from "./rest-timer";

type RequestInput = Parameters<typeof notificationApi.scheduleNotificationAsync>[0];
type ChannelInput = Parameters<typeof notificationApi.setNotificationChannelAsync>[1];

function fail(message: string): never {
  throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    fail(`${message}\n  actual: ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) fail(`${message}\n  actual: ${left}\n  expected: ${right}`);
}

type Recorded = {
  requests: unknown[][];
  schedules: RequestInput[];
  cancels: string[];
  channels: { id: string; channel: ChannelInput }[];
  scheduleError: { name: string; code?: string } | null;
  cancelError: { name: string; code?: string } | null;
  promptStillOpen: boolean;
};

function watch(): Recorded {
  const recorded: Recorded = {
    requests: [],
    schedules: [],
    cancels: [],
    channels: [],
    scheduleError: null,
    cancelError: null,
    promptStillOpen: false,
  };
  const request = notificationApi.requestPermissionsAsync.bind(notificationApi);
  const schedule = notificationApi.scheduleNotificationAsync.bind(notificationApi);
  const cancel = notificationApi.cancelScheduledNotificationAsync.bind(notificationApi);
  const channel = notificationApi.setNotificationChannelAsync.bind(notificationApi);

  notificationApi.requestPermissionsAsync = async (...args: Parameters<typeof request>) => {
    recorded.requests.push(args);
    const pending = request(...args);
    const winner = await Promise.race([
      pending.then((value) => ({ settled: true as const, value })),
      new Promise<{ settled: false }>((resolve) => setTimeout(() => resolve({ settled: false }), 500)),
    ]);
    // Headless Firefox leaves the real permission prompt open. The call already
    // entered requestPermissionsAsync; we do not invent a granted or denied result.
    if (!winner.settled) {
      recorded.promptStillOpen = true;
      throw new Error("The real notification prompt is still open");
    }
    return winner.value;
  };
  notificationApi.scheduleNotificationAsync = async (requestInput: RequestInput) => {
    recorded.schedules.push(requestInput);
    try {
      return await schedule(requestInput);
    } catch (error) {
      const caught = error as { name?: string; code?: string };
      recorded.scheduleError = { name: caught.name ?? "Error", code: caught.code };
      throw error;
    }
  };
  notificationApi.cancelScheduledNotificationAsync = async (identifier: string) => {
    recorded.cancels.push(identifier);
    try {
      return await cancel(identifier);
    } catch (error) {
      const caught = error as { name?: string; code?: string };
      recorded.cancelError = { name: caught.name ?? "Error", code: caught.code };
      throw error;
    }
  };
  notificationApi.setNotificationChannelAsync = async (id: string, input: ChannelInput) => {
    recorded.channels.push({ id, channel: input });
    return channel(id, input);
  };
  return recorded;
}

export async function runNotificationChecks(): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    os: Platform.OS,
    dom: Platform.isDOMAvailable,
  };

  assertEqual(restSeconds(null), DEFAULT_REST_SEC, "missing exercise uses 90s");
  assertEqual(restSeconds({}), DEFAULT_REST_SEC, "catalog exercise without rest_sec uses 90s");
  assertEqual(restSeconds({ rest_sec: undefined }), DEFAULT_REST_SEC, "undefined rest_sec uses 90s");
  assertEqual(restSeconds({ rest_sec: "90" }), DEFAULT_REST_SEC, "non-number rest_sec is ignored");
  assertEqual(restSeconds({ rest_sec: 0 }), DEFAULT_REST_SEC, "zero rest_sec is ignored");
  assertEqual(restSeconds({ rest_sec: Number.NaN }), DEFAULT_REST_SEC, "NaN rest_sec is ignored");
  assertEqual(restSeconds({ rest_sec: 45 }), 45, "numeric rest_sec is the duration");
  assertEqual(restSeconds({ rest_sec: 44.6 }), 45, "fractional rest_sec rounds");

  const parsed = parseTrigger({
    type: notificationApi.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: 45,
    channelId: REST_TIMER_CHANNEL_ID,
  });
  assertJsonEqual(parsed, {
    type: "timeInterval",
    seconds: 45,
    repeats: false,
    channelId: REST_TIMER_CHANNEL_ID,
  }, "real parseTrigger accepts the rest-timer trigger");

  const androidChannel = await setAndroidChannel(REST_TIMER_CHANNEL_ID, {
    name: "Rest timer",
    importance: notificationApi.AndroidImportance.HIGH,
  }).then(
    (value) => ({ ok: true as const, value }),
    (error: { name?: string; code?: string }) => ({ ok: false as const, name: error.name ?? "Error", code: error.code }),
  );
  report.androidChannel = androidChannel;
  if (androidChannel.ok) {
    fail("android channel create resolved without a device; this VM has no native channel manager");
  }
  assertEqual(androidChannel.code, "ERR_UNAVAILABLE", "real Android channel helper fails closed without a native module");

  if (!pushSupported()) {
    fail(`pushSupported() is false (OS ${process.env.EXPO_OS ?? "unset"}), so registerForPush would not reach getPermissionsAsync`);
  }

  const recorded = watch();
  const permission = await notificationApi.getPermissionsAsync();
  report.permission = permission;

  const token = await registerForPush();
  assertEqual(recorded.requests.length, 0, "registerForPush must not call requestPermissionsAsync");
  report.registerForPushToken = token;
  if (permission.status !== "granted") {
    assertEqual(token, null, "undetermined or denied registration returns null");
  }

  const scheduled = await scheduleRestEndNotification({
    seconds: restSeconds({ rest_sec: 45 }),
    title: "Rest complete",
    body: "Time for the next set.",
    channelName: "Rest timer",
  });
  report.scheduled = scheduled;

  if (permission.status === "granted") {
    assertEqual(recorded.schedules.length, 1, "granted permission schedules one local notification");
    const request = recorded.schedules[0];
    assertEqual(request?.identifier, REST_NOTIFICATION_ID, "rest alert uses the stable id");
    assertEqual(request?.content.title, "Rest complete", "notification title");
    assertEqual(request?.content.body, "Time for the next set.", "notification body");
    assertEqual(request?.content.sound, "default", "notification sound");
    const trigger = parseTrigger(request?.trigger);
    assertJsonEqual(trigger, {
      type: "timeInterval",
      seconds: 45,
      repeats: false,
      channelId: REST_TIMER_CHANNEL_ID,
    }, "scheduled trigger is a 45s rest-timer interval");
    assertEqual(scheduled, null, "without a native scheduler the helper returns null instead of throwing");
    assertEqual(recorded.scheduleError?.code, "ERR_UNAVAILABLE", "real scheduleNotificationAsync reports the native scheduler missing");
  } else {
    assertEqual(recorded.schedules.length, 0, "denied or undetermined permission does not schedule");
    assertEqual(scheduled, null, "denied or undetermined schedule returns null");
    assertEqual(recorded.scheduleError, null, "scheduleNotificationAsync was not called");
  }

  if (process.env.EXPO_OS === "android") {
    const restChannel = recorded.channels.find((entry) => entry.id === REST_TIMER_CHANNEL_ID);
    if (!restChannel) fail("android rest start must create the rest-timer channel");
    assertEqual(restChannel.channel.name, "Rest timer", "rest-timer channel has a clear name");
    assertEqual(restChannel.channel.importance, notificationApi.AndroidImportance.HIGH, "rest-timer channel importance");
    const pushChannel = recorded.channels.find((entry) => entry.id === "default");
    if (!pushChannel) fail("registerForPush still creates the default IronFlow channel");
    assertEqual(pushChannel.channel.name, "IronFlow", "push channel name stays IronFlow");
  }

  await cancelRestEndNotification();
  assertEqual(recorded.cancels.length, 1, "cancel calls cancelScheduledNotificationAsync");
  assertEqual(recorded.cancels[0], REST_NOTIFICATION_ID, "cancel uses the rest notification id");
  assertEqual(recorded.cancelError?.code, "ERR_UNAVAILABLE", "real cancelScheduledNotificationAsync reports the native scheduler missing");

  const requestsBeforeSettings = recorded.requests.length;
  const enabled = await enableDevicePush();
  report.enableDevicePush = enabled;
  if (permission.status === "granted") {
    assertEqual(recorded.requests.length, requestsBeforeSettings, "already granted settings path does not prompt again");
    assertEqual(enabled.status, "granted", "enableDevicePush reports granted");
  } else if (permission.canAskAgain === false) {
    assertEqual(recorded.requests.length, requestsBeforeSettings, "blocked permission does not prompt");
    assertEqual(enabled.status, "blocked", "enableDevicePush reports blocked");
  } else {
    assertEqual(recorded.requests.length, requestsBeforeSettings + 1, "undetermined settings path calls the real requestPermissionsAsync");
    const after = await notificationApi.getPermissionsAsync();
    report.permissionAfterRequest = after;
    report.promptStillOpen = recorded.promptStillOpen;
    if (recorded.promptStillOpen) {
      assertEqual(enabled.status, "denied", "an open prompt does not register a token");
      if (after.status === "granted") fail("permission changed to granted while the prompt was still open");
    } else {
      if (enabled.status !== "denied" && enabled.status !== "blocked" && enabled.status !== "granted") {
        fail(`unexpected enableDevicePush status ${enabled.status}`);
      }
      assertEqual(after.status === "granted" ? "granted" : after.canAskAgain === false ? "blocked" : "denied", enabled.status, "settings result matches the real permission read afterwards");
    }
  }

  report.requests = recorded.requests.length;
  report.schedules = recorded.schedules.map((entry) => entry.identifier);
  report.cancels = recorded.cancels;
  report.channels = recorded.channels.map((entry) => entry.id);
  return report;
}
