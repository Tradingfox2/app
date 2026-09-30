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
let flushing = false;
const listeners = new Set<(size: number) => void>();

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

export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let q = await loadQueue();
    if (q.length === 0) return;
    const remaining: QueueItem[] = [];
    for (const item of q) {
      try {
        await api.addSet(item.workout_id, item.payload);
      } catch {
        item.attempts += 1;
        remaining.push(item);
      }
    }
    await saveQueue(remaining);
  } finally {
    flushing = false;
  }
}

// Auto-flush on regained connectivity
try {
  NetInfo.addEventListener((state) => {
    if (state.isConnected) flushQueue().catch(() => {});
  });
} catch {
  // NetInfo may not be available in test env
}
