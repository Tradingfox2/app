/**
 * Phone activity day, from data the app already stores.
 *
 * Logged training time comes from a finished workout's `duration_sec`,
 * split across the local hours it actually occupied. Tonnage and distance
 * come from that day's sets (`weight_kg × reps`, `distance_m`) when those
 * fields are present. A finished phone recording adds its own
 * `activity.distance_m` (GPS, computed on the server). Steps and all-day
 * calories come only from a wearable_metrics row for that local day
 * (`import_day` when the importer set it). The recorder does not write those
 * rows.
 *
 * Missing measurements stay null. Nothing here estimates energy, steps,
 * distance, or a Move goal.
 */
import { localDayKey, trainingCalendar, type CalendarDay } from "./training-week";

export type ActivityWorkout = {
  id?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  duration_sec?: unknown;
  /** Phone recorder summary. Distance lives here, not on a set. */
  activity?: unknown;
};

export type HourBar = {
  hour: number;
  seconds: number;
};

export type DayTraining = {
  /** Seconds of finished workouts on this local day. Null when none were logged. */
  seconds: number | null;
  /** Hours that actually contain duration, earliest first. */
  hours: HourBar[];
  /** A workout started this day and has not been finished. */
  open: boolean;
  /** A finished workout started this day but stored no duration. */
  durationMissing: boolean;
};

export type WeekDayActivity = CalendarDay & {
  seconds: number | null;
  /** Share of the busiest day in this seven-day window. 0 when nothing was logged. */
  fill: number;
};

export type SetRollup = {
  tonnageKg: number | null;
  distanceM: number | null;
};

export type DailyReading = {
  value: number;
  device: string | null;
  simulated: boolean;
};

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseStarted(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isFinished(workout: ActivityWorkout): boolean {
  return typeof workout.ended_at === "string" && workout.ended_at.length > 0;
}

function positiveDuration(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/** Add `durationSec` to the local hours of `dayKey` that the session overlaps. */
function allocate(started: Date, durationSec: number, dayKey: string, into: Map<number, number>) {
  let leftMs = Math.round(durationSec * 1000);
  let cursor = started.getTime();
  let guard = 0;
  while (leftMs > 0 && guard < 72) {
    guard += 1;
    const at = new Date(cursor);
    const hourEnd = new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours() + 1).getTime();
    const slice = Math.min(leftMs, hourEnd - cursor);
    if (slice <= 0) break;
    if (localDayKey(at) === dayKey) {
      const hour = at.getHours();
      into.set(hour, (into.get(hour) ?? 0) + slice / 1000);
    }
    leftMs -= slice;
    cursor += slice;
  }
}

export function parseDayKey(value: unknown, now = new Date()): string {
  if (typeof value === "string") {
    const match = DAY_KEY.exec(value);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
        return value;
      }
    }
  }
  return localDayKey(now);
}

export function dateFromDayKey(key: string): Date {
  const match = DAY_KEY.exec(key);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function dayTraining(
  workouts: readonly (ActivityWorkout | null | undefined)[],
  dayKey: string,
): DayTraining {
  const hours = new Map<number, number>();
  let open = false;
  let durationMissing = false;
  for (const workout of workouts) {
    if (!workout) continue;
    const started = parseStarted(workout.started_at);
    if (!started) continue;
    const startKey = localDayKey(started);
    if (!isFinished(workout)) {
      if (startKey === dayKey) open = true;
      continue;
    }
    const duration = positiveDuration(workout.duration_sec);
    if (duration === null) {
      if (startKey === dayKey) durationMissing = true;
      continue;
    }
    allocate(started, duration, dayKey, hours);
  }
  const bars = [...hours.entries()]
    .filter(([, seconds]) => seconds > 0)
    .sort((left, right) => left[0] - right[0])
    .map(([hour, seconds]) => ({ hour, seconds }));
  const total = bars.reduce((sum, bar) => sum + bar.seconds, 0);
  return {
    seconds: total > 0 ? total : null,
    hours: bars,
    open,
    durationMissing: durationMissing && total <= 0,
  };
}

/** Last seven local days, with a ring fill from logged duration only. */
export function weekActivity(
  workouts: readonly (ActivityWorkout | null | undefined)[],
  now = new Date(),
): WeekDayActivity[] {
  const days = trainingCalendar(workouts, now);
  const secondsByDay = new Map<string, number>();
  for (const day of days) {
    const training = dayTraining(workouts, day.key);
    if (training.seconds !== null) secondsByDay.set(day.key, training.seconds);
  }
  const busiest = Math.max(0, ...secondsByDay.values());
  return days.map((day) => {
    const seconds = secondsByDay.get(day.key) ?? null;
    const fill = seconds !== null && busiest > 0 ? seconds / busiest : 0;
    return { ...day, seconds, fill };
  });
}

/** Workout ids whose session started on this local day. Sets belong to that session. */
export function workoutIdsOnDay(
  workouts: readonly (ActivityWorkout | null | undefined)[],
  dayKey: string,
): string[] {
  const ids: string[] = [];
  for (const workout of workouts) {
    if (!workout || typeof workout.id !== "string" || workout.id.length === 0) continue;
    const started = parseStarted(workout.started_at);
    if (!started || localDayKey(started) !== dayKey) continue;
    ids.push(workout.id);
  }
  return ids;
}

/**
 * GPS distance from finished recordings that started on this local day.
 * A missing or non-positive distance is not a measurement. These rows are
 * shaped like sets so they can be added with `rollupSets`.
 */
export function recordedDistanceRows(
  workouts: readonly (ActivityWorkout | null | undefined)[],
  dayKey: string,
): { distance_m: number }[] {
  const rows: { distance_m: number }[] = [];
  for (const workout of workouts) {
    if (!workout || !isFinished(workout)) continue;
    const started = parseStarted(workout.started_at);
    if (!started || localDayKey(started) !== dayKey) continue;
    const activity = workout.activity;
    if (!activity || typeof activity !== "object") continue;
    const meters = finiteNumber((activity as Record<string, unknown>).distance_m);
    if (meters === null || meters <= 0) continue;
    rows.push({ distance_m: meters });
  }
  return rows;
}

export function rollupSets(sets: readonly unknown[]): SetRollup {
  let tonnage = 0;
  let sawTonnage = false;
  let distance = 0;
  let sawDistance = false;
  for (const row of sets) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const reps = finiteNumber(record.reps);
    const weight = finiteNumber(record.weight_kg);
    if (reps !== null && weight !== null && reps * weight > 0) {
      tonnage += reps * weight;
      sawTonnage = true;
    }
    const meters = finiteNumber(record.distance_m);
    if (meters !== null && meters > 0) {
      distance += meters;
      sawDistance = true;
    }
  }
  return {
    tonnageKg: sawTonnage ? tonnage : null,
    distanceM: sawDistance ? distance : null,
  };
}

/**
 * Latest wearable row for `dayKey`.
 * `import_day` wins over the UTC timestamp so a midnight export stays on the
 * day the importer named. A non-positive value is not a measurement.
 * A real row wins over a simulated one.
 */
export function readDailyMetric(rows: readonly unknown[], dayKey: string): DailyReading | null {
  let best: { at: number; simulated: boolean; reading: DailyReading } | null = null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const value = finiteNumber(record.value);
    if (value === null || value <= 0) continue;
    const importDay = typeof record.import_day === "string" && DAY_KEY.test(record.import_day)
      ? record.import_day
      : null;
    let at = Number.NEGATIVE_INFINITY;
    let key = importDay;
    if (typeof record.recorded_at === "string" && record.recorded_at.length > 0) {
      const recorded = new Date(record.recorded_at);
      if (!Number.isNaN(recorded.getTime())) {
        at = recorded.getTime();
        if (!key) key = localDayKey(recorded);
      }
    }
    if (key !== dayKey) continue;
    const simulated = record.simulated === true;
    const reading: DailyReading = {
      value,
      device: typeof record.device === "string" && record.device.length > 0 ? record.device : null,
      simulated,
    };
    const prefer = best === null
      || (best.simulated && !simulated)
      || (best.simulated === simulated && at >= best.at);
    if (prefer) best = { at, simulated, reading };
  }
  return best?.reading ?? null;
}

/** Rounded minutes for a logged duration. Null when the span is under half a minute. */
export function loggedMinutes(seconds: number): number | null {
  if (!(seconds > 0)) return null;
  const minutes = Math.round(seconds / 60);
  return minutes > 0 ? minutes : null;
}
