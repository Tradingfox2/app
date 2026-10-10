/**
 * Offline-first queue for workout set writes.
 *
 * When a set is added, we (1) push it into the local queue, (2) attempt to
 * POST to the server. On failure or absence of connectivity the entry stays
 * queued; a background flusher retries when the network comes back or when
 * flushQueue() is called explicitly (pull-to-refresh, opening the workout).
 *
 * Callers should use `enqueueSet` — never `api.addSet` directly.
 */
import NetInfo from "@react-native-community/netinfo";
import { api } from "./api";
import { storage } from "./utils/storage";

type SetPayload = {
  exercise_id: string;
  set_index: number;
  reps?: number | null;
  weight_kg?: number | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  rpe?: number | null;
  rest_sec?: number | null;
};

type QueueItem = {
  local_id: string;
  workout_id: string;
  payload: SetPayload;
  created_at: number;
  attempts: number;
};

const KEY = "ironflow_offline_queue";
const listeners = new Set<(size: number) => void>();
/** Serializes flushes so a later enqueue is not wiped by an in-flight save. */
let flushTail: Promise<number> = Promise.resolve(0);

async function loadQueue(): Promise<QueueItem[]> {
  const raw = (await storage.getItem(KEY, null)) as unknown;
  if (Array.isArray(raw)) return raw as QueueItem[];
  return [];
}

async function saveQueue(q: QueueItem[]): Promise<void> {
  await storage.setItem(KEY, q as any);
  listeners.forEach((l) => l(q.length));
}

export function onQueueChange(cb: (size: number) => void): () => void {
  listeners.add(cb);
  loadQueue().then((q) => cb(q.length));
  return () => {
    listeners.delete(cb);
  };
}

export async function queueSize(): Promise<number> {
  return (await loadQueue()).length;
}

/** Sets for one workout that have not reached the server yet. */
export async function pendingFor(workoutId: string): Promise<number> {
  const q = await loadQueue();
  return q.filter((item) => item.workout_id === workoutId).length;
}

/** Count plus whether a flush has already failed for this workout. Rows stay queued. */
export async function pendingState(workoutId: string): Promise<{ count: number; failed: boolean }> {
  const q = await loadQueue();
  const mine = q.filter((item) => item.workout_id === workoutId);
  return { count: mine.length, failed: mine.some((item) => item.attempts > 0) };
}

export async function enqueueSet(workoutId: string, payload: SetPayload): Promise<void> {
  const q = await loadQueue();
  q.push({
    local_id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    workout_id: workoutId,
    payload,
    created_at: Date.now(),
    attempts: 0,
  });
  await saveQueue(q);
  // Fire and forget — do not block UI
  flushQueue().catch(() => {});
}

export async function flushQueue(): Promise<number> {
  const run = flushTail.catch(() => 0).then(async () => {
    const snapshot = await loadQueue();
    if (snapshot.length === 0) return 0;
    const succeeded = new Set<string>();
    const attempts = new Map<string, number>();
    for (const item of snapshot) {
      try {
        await api.addSet(item.workout_id, item.payload);
        succeeded.add(item.local_id);
      } catch {
        attempts.set(item.local_id, item.attempts + 1);
      }
    }
    // Re-read so a set enqueued mid-flush is kept, and only confirmed posts leave.
    const latest = await loadQueue();
    const remaining = latest
      .filter((item) => !succeeded.has(item.local_id))
      .map((item) =>
        attempts.has(item.local_id) ? { ...item, attempts: attempts.get(item.local_id) ?? item.attempts } : item,
      );
    await saveQueue(remaining);
    return remaining.length;
  });
  flushTail = run.then(
    () => 0,
    () => 0,
  );
  return run;
}

// Auto-flush on regained connectivity
try {
  NetInfo.addEventListener((state) => {
    if (state.isConnected) flushQueue().catch(() => {});
  });
} catch {
  // NetInfo may not be available in test env
}
