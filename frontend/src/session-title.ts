/** Dated session title shared by Home, Workouts, and check-in. */
export function datedSessionTitle(
  t: (source: string, values?: Record<string, string | number>) => string,
  formatDate: (value: Date, options?: Intl.DateTimeFormatOptions) => string,
  when = new Date(),
): string {
  return `${t("Session")} · ${formatDate(when, { weekday: "short", day: "numeric", month: "short" })}`;
}
