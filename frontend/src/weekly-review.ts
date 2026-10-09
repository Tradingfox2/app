export type WeeklyReview = {
  iso_week: string;
  headline: string;
  wins: string;
  watch: string;
  next_week_change: string;
};

/** A review card only when the payload is the four sentences Home renders. */
export function readWeeklyReview(value: unknown): WeeklyReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.headline !== "string" || !row.headline.trim()) return null;
  if (typeof row.wins !== "string" || typeof row.watch !== "string" || typeof row.next_week_change !== "string") return null;
  return {
    iso_week: typeof row.iso_week === "string" ? row.iso_week : "",
    headline: row.headline,
    wins: row.wins,
    watch: row.watch,
    next_week_change: row.next_week_change,
  };
}

/**
 * Home may ask for the Monday review from local Monday through Saturday.
 * Sunday is the day before Monday, so that open does not call.
 */
export function weeklyReviewDue(now: Date): boolean {
  const day = now.getDay();
  return day >= 1 && day <= 6;
}
