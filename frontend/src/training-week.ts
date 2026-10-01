/**
 * Home week calendar and volume, from data the app already loads.
 *
 * Totals come from GET /home/today (`workouts_this_week` and `training`).
 * That payload is a rolling 7×24h window and has no per-day dates.
 * The calendar reads `started_at` on GET /workouts (the same list the
 * Workout tab uses) and marks the last seven local calendar days.
 * Missing fields stay missing so the screen cannot paint a fake zero.
 */

export type TrainingTotals = {
  sets: number;
  tonnageKg: number;
  minutes: number;
  muscles: number;
  streakDays: number;
};

export type CalendarDay = {
  /** Local calendar date, YYYY-MM-DD. */
  key: string;
  date: Date;
  trained: boolean;
  isToday: boolean;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function wholeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function readWorkoutCount(data: unknown): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return wholeNumber((data as { workouts_this_week?: unknown }).workouts_this_week);
}

export function readTrainingTotals(data: unknown): TrainingTotals | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const training = (data as { training?: unknown }).training;
  if (!training || typeof training !== "object" || Array.isArray(training)) return null;
  const block = training as Record<string, unknown>;
  const sets = wholeNumber(block.sets_week);
  const tonnageKg = finiteNumber(block.tonnage_week_kg);
  const minutes = wholeNumber(block.minutes_week);
  const streakDays = wholeNumber(block.streak_days);
  const muscles = block.muscles_week;
  if (sets === null || tonnageKg === null || minutes === null || streakDays === null) return null;
  if (!Array.isArray(muscles) || muscles.some((muscle) => typeof muscle !== "string")) return null;
  return { sets, tonnageKg, minutes, muscles: muscles.length, streakDays };
}

/** Last seven local calendar days, oldest first, ending today. */
export function trainingCalendar(
  workouts: readonly ({ started_at?: string | null } | null | undefined)[],
  now = new Date(),
): CalendarDay[] {
  const trained = new Set<string>();
  for (const workout of workouts) {
    const raw = workout?.started_at;
    if (typeof raw !== "string" || raw.length === 0) continue;
    const started = new Date(raw);
    if (Number.isNaN(started.getTime())) continue;
    trained.add(localDayKey(started));
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: CalendarDay[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = localDayKey(date);
    days.push({ key, date, trained: trained.has(key), isToday: offset === 0 });
  }
  return days;
}
