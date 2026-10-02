import assert from "node:assert/strict";
import {
  beatsShownLastTime,
  finishedToday,
  sessionWhy,
  swapChoices,
} from "./session-layout.ts";

const bench = { sets: 4, reps_min: 6, reps_max: 8 };
assert.equal(
  sessionWhy("accumulation", { exercises: [bench] })?.key,
  "Why this session: {focus} builds the pattern with {sets} sets of {reps}.",
);
assert.equal(sessionWhy("accumulation", { exercises: [bench] })?.sets, 4);
assert.equal(sessionWhy("deload", { exercises: [bench, { sets: 2, reps_min: 8, reps_max: 8 }] })?.sets, 6);
assert.equal(sessionWhy("peak", { exercises: [bench] })?.reps, "6–8");
assert.equal(
  sessionWhy("mystery", { exercises: [bench] })?.key,
  "Why this session: {focus}, {sets} sets of {reps}.",
);
assert.equal(sessionWhy("accumulation", { exercises: [] }), null);
assert.equal(sessionWhy("accumulation", { exercises: [{ sets: 0, reps_min: 5, reps_max: 5 }] }), null);

const catalog = [
  { slug: "bench-press", name: "Bench Press", primary_muscle_slug: "chest" },
  { slug: "dip", name: "Dip", primary_muscle_slug: "chest" },
  { slug: "row", name: "Row", primary_muscle_slug: "back" },
  { slug: "fly", name: "Fly", primary_muscle_slug: "chest" },
];
assert.deepEqual(
  swapChoices(catalog, "bench-press", ["bench-press", "fly"]).map((item) => item.slug),
  ["dip"],
);
assert.deepEqual(
  swapChoices(catalog, "missing", ["missing"]).map((item) => item.slug),
  ["bench-press", "dip", "row", "fly"],
);

assert.equal(beatsShownLastTime({ weightKg: 62.5, reps: 8 }, { weightKg: 60, reps: 8 }), true);
assert.equal(beatsShownLastTime({ weightKg: 60, reps: 9 }, { weightKg: 60, reps: 8 }), true);
assert.equal(beatsShownLastTime({ weightKg: 70, reps: 4 }, { weightKg: 60, reps: 8 }), false);
assert.equal(beatsShownLastTime({ weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }), false);
assert.equal(beatsShownLastTime({ weightKg: 60, reps: 8 }, null), false);
assert.equal(beatsShownLastTime({ weightKg: 0, reps: 12 }, { weightKg: 0, reps: 10 }), true);

const now = new Date(2026, 9, 2, 18, 0, 0);
const today = finishedToday(
  [
    { id: "open", title: "Still going", started_at: "2026-10-02T08:00:00", ended_at: null, duration_sec: null },
    { id: "done", title: "Push", started_at: "2026-10-02T09:00:00", ended_at: "2026-10-02T10:00:00", duration_sec: 3600 },
    { id: "old", title: "Yesterday", started_at: "2026-10-01T09:00:00", ended_at: "2026-10-01T10:00:00", duration_sec: 1800 },
    { id: "ride", title: "Ride", started_at: "2026-10-02T16:00:00", ended_at: "2026-10-02T17:00:00", duration_sec: 2400, activity: { distance_m: 1000 } },
    { id: "blank", title: "  ", started_at: "2026-10-02T11:00:00", ended_at: "2026-10-02T12:00:00", duration_sec: 60 },
  ],
  now,
);
assert.deepEqual(
  today.map((row) => row.id),
  ["done", "ride"],
);
assert.equal(today[0]?.minutes, 60);
assert.equal(today[1]?.recorded, true);
assert.equal(today[0]?.recorded, false);
