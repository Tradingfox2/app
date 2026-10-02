/**
 * One local reminder when a planned session was missed.
 *
 * The program week stays calendar age: `(now - created) / 7 days`, the same
 * count `resolve_program_day` already uses. This file does not choose a
 * different day to start, and it does not replay the missed one. Home and
 * `/program` keep the session they already showed.
 *
 * Days are ordered, then spaced across that 7-day block. The spacing is only
 * the reminder clock. It is not a weekday and it is not a challenge.
 */

export const ALLOWED_NOTE_START_HOUR = 8;
export const ALLOWED_NOTE_END_HOUR = 21;
export const MISSED_SESSION_CHANNEL_ID = "missed-session";
export const MISSED_SESSION_KIND = "missed_session";

const DAY_MS = 86_400_000;
const LEAD_MS = 60_000;

export type MissedSessionCopy = {
  title: string;
  body: string;
};

export type MissedSessionRequest = {
  identifier: string;
  content: {
    title: string;
    body: string;
    sound: false;
    interruptionLevel: "passive";
    priority: "low";
    data: { kind: typeof MISSED_SESSION_KIND };
  };
  trigger: {
    type: "date";
    date: Date;
    channelId: typeof MISSED_SESSION_CHANNEL_ID;
  };
};

export type MissedSessionPlan =
  | { action: "schedule"; request: MissedSessionRequest; cancelIdentifier: string | null }
  | { action: "cancel"; identifier: string }
  | { action: "none" };

type PlannedDay = { dayIndex: number; focus: string };
type PlannedWeek = { weekIndex: number; days: PlannedDay[] };
type ActivePlan = { id: string; createdAt: Date; weeks: PlannedWeek[] };

export function calendarWeekIndex(createdAt: Date, now: Date, weekCount: number): number {
  const elapsed = Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS);
  return Math.min(Math.floor(elapsed / 7) + 1, Math.max(weekCount, 1));
}

/** Local hour Expo can deliver. The trigger has no quiet-hours field. */
export function hourIsAllowed(when: Date): boolean {
  const hour = when.getHours();
  return hour >= ALLOWED_NOTE_START_HOUR && hour < ALLOWED_NOTE_END_HOUR;
}

export function nextAllowedNoteTime(now: Date): Date {
  const earliest = new Date(now.getTime() + LEAD_MS);
  if (hourIsAllowed(earliest)) return earliest;
  const next = new Date(earliest);
  next.setMinutes(0, 0, 0);
  if (earliest.getHours() >= ALLOWED_NOTE_END_HOUR) next.setDate(next.getDate() + 1);
  next.setHours(ALLOWED_NOTE_START_HOUR);
  return next;
}

/**
 * Foreground presentation. Sync on purpose: Expo discards a notification
 * whose handler is still running after 3 seconds.
 */
export function presentationFor(data: { kind?: unknown } | null | undefined): {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
} {
  const quiet = data?.kind === MISSED_SESSION_KIND;
  return {
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: !quiet,
    shouldSetBadge: !quiet,
  };
}

/** A tap opens the existing plan. It does not open another person. */
export function missedSessionRoute(data: { kind?: unknown } | null | undefined): "/program" | null {
  return data?.kind === MISSED_SESSION_KIND ? "/program" : null;
}

export function missedSessionIdentifier(userId: string, programId: string, weekIndex: number): string {
  return `ironflow-missed-${userId}-${programId}-w${weekIndex}`;
}

type WeekState =
  | { kind: "absent" }
  | { kind: "closed" }
  | { kind: "early" }
  | { kind: "missed"; identifier: string }
  | { kind: "complete" };

export function decideMissedSessionNote(input: {
  programs: unknown;
  workouts: unknown;
  now: Date;
  userId: string;
  storedIdentifier: string | null;
  copy: MissedSessionCopy;
}): MissedSessionPlan {
  const stored = input.storedIdentifier || null;
  const state = weekState(input.programs, input.workouts, input.now, input.userId);
  switch (state.kind) {
    case "missed":
      if (stored === state.identifier) return { action: "none" };
      return {
        action: "schedule",
        cancelIdentifier: stored,
        request: {
          identifier: state.identifier,
          content: {
            title: input.copy.title,
            body: input.copy.body,
            sound: false,
            interruptionLevel: "passive",
            priority: "low",
            data: { kind: MISSED_SESSION_KIND },
          },
          trigger: {
            type: "date",
            date: nextAllowedNoteTime(input.now),
            channelId: MISSED_SESSION_CHANNEL_ID,
          },
        },
      };
    case "early":
      // A due session was caught up. Leave the one pending note alone.
      return { action: "none" };
    case "absent":
    case "closed":
    case "complete":
      // A finished week, a plan that ended, or no plan: do not send.
      if (stored) return { action: "cancel", identifier: stored };
      return { action: "none" };
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

function weekState(programs: unknown, workouts: unknown, now: Date, userId: string): WeekState {
  const plan = readActivePlan(programs);
  if (!plan || !userId) return { kind: "absent" };
  const elapsed = Math.floor((now.getTime() - plan.createdAt.getTime()) / DAY_MS);
  if (elapsed < 0 || elapsed >= plan.weeks.length * 7) return { kind: "closed" };
  const weekIndex = calendarWeekIndex(plan.createdAt, now, plan.weeks.length);
  const week = plan.weeks.find((item) => item.weekIndex === weekIndex);
  if (!week) return { kind: "closed" };
  const ordered = week.days
    .filter((day) => day.focus !== "rest" && day.dayIndex >= 1 && day.dayIndex <= 7)
    .sort((left, right) => left.dayIndex - right.dayIndex);
  if (ordered.length === 0) return { kind: "absent" };
  const sessions = Array.isArray(workouts) ? workouts : [];
  if (ordered.every((day) => finished(sessions, plan.id, weekIndex, day.dayIndex))) {
    return { kind: "complete" };
  }
  const missed = ordered.some((day, slot) => {
    const due = (weekIndex - 1) * 7 + reminderOffset(slot, ordered.length);
    return elapsed >= due && !finished(sessions, plan.id, weekIndex, day.dayIndex);
  });
  if (!missed) return { kind: "early" };
  return { kind: "missed", identifier: missedSessionIdentifier(userId, plan.id, weekIndex) };
}

/**
 * When, inside the 7-day block, this ordered session counts as missed.
 * The last session uses day 6 so the reminder still fits before the next week.
 */
function reminderOffset(slot: number, count: number): number {
  const spread = Math.round(((slot + 1) * 6) / count);
  return Math.min(6, Math.max(1, spread));
}

function finished(workouts: unknown[], programId: string, weekIndex: number, dayIndex: number): boolean {
  return workouts.some((workout) => {
    if (!workout || typeof workout !== "object") return false;
    const row = workout as Record<string, unknown>;
    if (row.ended_at == null || row.ended_at === "") return false;
    const source = row.source;
    if (!source || typeof source !== "object") return false;
    const src = source as Record<string, unknown>;
    return src.kind === "program_day"
      && src.program_id === programId
      && finiteNumber(src.week_index) === weekIndex
      && finiteNumber(src.day_index) === dayIndex;
  });
}

function readActivePlan(programs: unknown): ActivePlan | null {
  if (!Array.isArray(programs)) return null;
  for (const row of programs) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (record.status !== "active" || typeof record.id !== "string") continue;
    const createdAt = readInstant(record.created_at);
    const program = record.program;
    const weeksRaw = program && typeof program === "object"
      ? (program as { weeks?: unknown }).weeks
      : null;
    if (!createdAt || !Array.isArray(weeksRaw)) continue;
    const weeks = weeksRaw.flatMap((week) => readWeek(week));
    if (weeks.length === 0) continue;
    return { id: record.id, createdAt, weeks };
  }
  return null;
}

function readWeek(week: unknown): PlannedWeek[] {
  if (!week || typeof week !== "object") return [];
  const record = week as Record<string, unknown>;
  const weekIndex = finiteNumber(record.week_index);
  if (weekIndex == null || !Array.isArray(record.days)) return [];
  const days = record.days.flatMap((day) => {
    if (!day || typeof day !== "object") return [];
    const item = day as Record<string, unknown>;
    const dayIndex = finiteNumber(item.day_index);
    if (dayIndex == null || typeof item.focus !== "string") return [];
    return [{ dayIndex, focus: item.focus }];
  });
  return [{ weekIndex, days }];
}

function readInstant(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
