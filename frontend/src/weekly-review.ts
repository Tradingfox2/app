export type WeeklyReview = {
  iso_week: string;
  headline: string;
  wins: string;
  watch: string;
  next_week_change: string;
};

/**
 * Home may ask for the Monday review from local Monday through Saturday.
 * Sunday is the day before Monday, so that open does not call.
 */
export function weeklyReviewDue(now: Date): boolean {
  const day = now.getDay();
  return day >= 1 && day <= 6;
}
