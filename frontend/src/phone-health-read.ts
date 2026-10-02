/**
 * What a phone health read is allowed to mean.
 *
 * A positive sample is shown. A granted read with nothing in the default
 * window is empty (blank), never zero. A denied or unknown read is hidden.
 * Health Connect only exposes about 30 days unless an app asks for history,
 * which this app does not, so an older empty day is not proof of absence.
 * Apple does not reveal whether a read was denied; that case stays unknown.
 */
import { dateFromDayKey, type DailyReading } from "./activity-day";

export const DEFAULT_HISTORY_DAYS = 30;

export type ReadAccess = "granted" | "denied" | "unknown";

export type PhoneRead<T> =
  | { kind: "hidden" }
  | { kind: "empty" }
  | { kind: "value"; value: T };

export type HeartSpan = { min: number; max: number };

export type PhoneWorkout = {
  key: string;
  /** "Workout" is translated. Any other label is the title stored on the phone. */
  label: string;
  startedAt: string;
  endedAt: string | null;
};

export type PhoneDay = {
  steps: PhoneRead<number>;
  heartRate: PhoneRead<HeartSpan>;
  workouts: PhoneRead<PhoneWorkout[]>;
  device: "Apple Health" | "Health Connect" | null;
};

export function hiddenPhoneDay(): PhoneDay {
  return {
    steps: { kind: "hidden" },
    heartRate: { kind: "hidden" },
    workouts: { kind: "hidden" },
    device: null,
  };
}

export function dayInsideDefaultHistory(dayKey: string, now = new Date()): boolean {
  const day = dateFromDayKey(dayKey);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oldest = new Date(today);
  oldest.setDate(oldest.getDate() - (DEFAULT_HISTORY_DAYS - 1));
  return day.getTime() >= oldest.getTime() && day.getTime() <= today.getTime();
}

/** Local midnight inclusive, next local midnight exclusive. */
export function localDayBounds(dayKey: string): { start: Date; end: Date } {
  const start = dateFromDayKey(dayKey);
  return {
    start,
    end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1),
  };
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function interpretSteps(
  access: ReadAccess,
  inWindow: boolean,
  total: number | null,
): PhoneRead<number> {
  const sample = positive(total);
  if (sample !== null) return { kind: "value", value: sample };
  if (access !== "granted" || !inWindow) return { kind: "hidden" };
  return { kind: "empty" };
}

export function interpretHeartRate(
  access: ReadAccess,
  inWindow: boolean,
  beats: readonly number[],
): PhoneRead<HeartSpan> {
  const samples = beats.filter((beat) => positive(beat) !== null);
  if (samples.length > 0) {
    return { kind: "value", value: { min: Math.min(...samples), max: Math.max(...samples) } };
  }
  if (access !== "granted" || !inWindow) return { kind: "hidden" };
  return { kind: "empty" };
}

export function interpretWorkouts(
  access: ReadAccess,
  inWindow: boolean,
  rows: readonly PhoneWorkout[],
): PhoneRead<PhoneWorkout[]> {
  const sessions = rows.filter((row) => row.startedAt.length > 0);
  if (sessions.length > 0) return { kind: "value", value: sessions };
  if (access !== "granted" || !inWindow) return { kind: "hidden" };
  return { kind: "empty" };
}

/**
 * A stored wearable row wins. Phone steps are never added on top of it,
 * and a missing phone sample does not become zero.
 */
export function pickStepReading(
  server: DailyReading | null,
  phone: PhoneRead<number>,
  device: string | null,
): DailyReading | null {
  if (server) return server;
  if (phone.kind !== "value" || positive(phone.value) === null || !device) return null;
  return { value: phone.value, device, simulated: false };
}
