/**
 * Small session-layout decisions from data the app already has.
 * Swap choices come from the exercise catalog. The why-line reads the
 * stored phase, focus, and set counts. Today's finished rows are workouts
 * that already ended on this local day. A set beats last time only against
 * the pair already shown on the logger.
 */

import { localDayKey } from "./training-week";

export type CatalogExercise = {
  slug: string;
  name: string;
  primary_muscle_slug?: string | null;
};

export type SessionWhy = {
  key: string;
  sets: number;
  reps: string;
};

export type FinishedSession = {
  id: string;
  title: string;
  minutes: number | null;
  recorded: boolean;
};

const WHY_KEY: Record<string, string> = {
  accumulation: "Why this session: {focus} builds the pattern with {sets} sets of {reps}.",
  intensification: "Why this session: {focus} keeps the lifts and asks for {sets} heavier sets.",
  deload: "Why this session: {focus} stays in the plan with {sets} easier sets so you recover.",
  peak: "Why this session: {focus} is the heavy day, {sets} sets of {reps}.",
};

const GENERIC_WHY = "Why this session: {focus}, {sets} sets of {reps}.";

type PlannedExercise = {
  sets?: unknown;
  reps_min?: unknown;
  reps_max?: unknown;
};

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One line from the day already stored on the plan. No new program. */
export function sessionWhy(
  phase: string,
  day: { exercises: readonly PlannedExercise[] },
): SessionWhy | null {
  if (day.exercises.length === 0) return null;
  let sets = 0;
  for (const exercise of day.exercises) {
    const count = whole(exercise.sets);
    if (count === null || count <= 0) return null;
    sets += count;
  }
  const lead = day.exercises[0];
  const repsMin = whole(lead?.reps_min);
  const repsMax = whole(lead?.reps_max);
  if (repsMin === null || repsMax === null || repsMin <= 0 || repsMax <= 0) return null;
  const reps = repsMin === repsMax ? String(repsMin) : `${repsMin}–${repsMax}`;
  return { key: WHY_KEY[phase] ?? GENERIC_WHY, sets, reps };
}

/** Same-muscle replacements first. Exercises already on the day stay out. */
export function swapChoices(
  catalog: readonly CatalogExercise[],
  currentSlug: string,
  daySlugs: readonly string[],
  limit = 6,
): CatalogExercise[] {
  const current = catalog.find((item) => item.slug === currentSlug);
  const muscle = current?.primary_muscle_slug;
  const taken = new Set(daySlugs);
  const pool = catalog.filter((item) => item.slug && item.name && item.slug !== currentSlug && !taken.has(item.slug));
  const same = muscle ? pool.filter((item) => item.primary_muscle_slug === muscle) : [];
  return (same.length > 0 ? same : pool).slice(0, limit);
}

export function beatsShownLastTime(
  logged: { weightKg: number; reps: number },
  shown: { weightKg: number; reps: number } | null,
): boolean {
  if (!shown) return false;
  if (!Number.isFinite(logged.weightKg) || !Number.isFinite(logged.reps)) return false;
  if (!Number.isFinite(shown.weightKg) || !Number.isFinite(shown.reps)) return false;
  if (shown.weightKg < 0 || shown.reps < 0 || logged.reps <= 0) return false;
  const heavier = logged.weightKg > shown.weightKg && logged.reps >= shown.reps;
  const moreReps = logged.reps > shown.reps && logged.weightKg >= shown.weightKg;
  return heavier || moreReps;
}

type WorkoutRow = {
  id?: unknown;
  title?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  duration_sec?: unknown;
  activity?: unknown;
};

/** Finished sessions whose start falls on the local day. Open sessions stay out. */
export function finishedToday(
  workouts: readonly WorkoutRow[] | null | undefined,
  now = new Date(),
): FinishedSession[] {
  if (!workouts) return [];
  const today = localDayKey(now);
  const rows: FinishedSession[] = [];
  for (const workout of workouts) {
    if (!workout || typeof workout.id !== "string" || typeof workout.title !== "string") continue;
    if (!workout.title.trim()) continue;
    if (typeof workout.ended_at !== "string" || workout.ended_at.length === 0) continue;
    if (typeof workout.started_at !== "string") continue;
    const started = new Date(workout.started_at);
    if (Number.isNaN(started.getTime()) || localDayKey(started) !== today) continue;
    const duration = whole(workout.duration_sec);
    const minutes = duration !== null && duration > 0 ? Math.round(duration / 60) : null;
    rows.push({
      id: workout.id,
      title: workout.title,
      minutes: minutes !== null && minutes > 0 ? minutes : null,
      recorded: workout.activity !== null && typeof workout.activity === "object",
    });
  }
  return rows;
}
