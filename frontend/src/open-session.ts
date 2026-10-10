import { api } from "@/src/api";

export type OpenSession = {
  id: string;
  title?: string | null;
  ended_at?: string | null;
  activity?: unknown;
};

export function isActivitySession(row: { activity?: unknown }): boolean {
  return Boolean(row.activity) && typeof row.activity === "object";
}

/** Lift logger, or the record screen when the row is an activity. Never the other way around. */
export function openSessionHref(row: OpenSession): `/record/${string}` | `/workout/${string}` {
  if (isActivitySession(row)) return `/record/${row.id}`;
  return `/workout/${row.id}`;
}

/**
 * Every row that has not ended. The call throws when the list cannot be read
 * so Home and Plan can stop instead of starting a second session.
 */
export async function listOpenSessions(): Promise<OpenSession[]> {
  const existing = await api.workouts();
  if (!Array.isArray(existing)) return [];
  const open: OpenSession[] = [];
  for (const row of existing) {
    if (!row || typeof row !== "object") continue;
    const session = row as OpenSession;
    if (typeof session.id !== "string" || session.id.length === 0 || session.ended_at) continue;
    open.push(session);
  }
  return open;
}
