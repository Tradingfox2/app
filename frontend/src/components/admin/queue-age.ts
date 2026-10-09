type Translate = (source: string, values?: Record<string, string | number>) => string;

/**
 * Hours before the oldest open report, or the oldest unassigned ticket, is
 * highlighted on the staff console.
 *
 * This is a product target for the queue, documented in
 * `docs/admin-console-audit.md`. It is not a contractual or legal SLA.
 */
export const ADMIN_QUEUE_TARGET_HOURS = 24;

export function ageHours(iso: string): number | null {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(elapsed)) return null;
  return elapsed / 3_600_000;
}

export function isOverdue(iso: string | null | undefined, targetHours = ADMIN_QUEUE_TARGET_HOURS): boolean {
  if (!iso) return false;
  const hours = ageHours(iso);
  return hours != null && hours >= targetHours;
}

export function agePhrase(iso: string, t: Translate): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return t("Just now");
  if (minutes < 60) return t("{n}m ago", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("{n}h ago", { n: hours });
  return t("{n}d ago", { n: Math.floor(hours / 24) });
}

/** Same opened / updated line the support queue uses. No update time means the row was never closed or edited. */
export function queueAge(
  createdAt: string,
  updatedAt: string | null | undefined,
  t: Translate,
): string {
  const opened = t("Opened {age}", { age: agePhrase(createdAt, t) });
  if (!updatedAt) return opened;
  return `${opened} · ${t("Updated {age}", { age: agePhrase(updatedAt, t) })}`;
}
