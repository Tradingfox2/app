import assert from "node:assert/strict";
import {
  dayTraining,
  loggedMinutes,
  parseDayKey,
  readDailyMetric,
  rollupSets,
  weekActivity,
  workoutIdsOnDay,
} from "./activity-day.ts";

const day = "2026-10-01";

const split = dayTraining(
  [{ id: "a", started_at: "2026-10-01T10:30:00", ended_at: "2026-10-01T12:00:00", duration_sec: 5400 }],
  day,
);
assert.equal(split.seconds, 5400);
assert.deepEqual(split.hours, [
  { hour: 10, seconds: 1800 },
  { hour: 11, seconds: 3600 },
]);
assert.equal(split.open, false);

const spillStart = dayTraining(
  [{ id: "b", started_at: "2026-10-01T23:30:00", ended_at: "2026-10-02T00:30:00", duration_sec: 3600 }],
  day,
);
assert.equal(spillStart.seconds, 1800);
assert.deepEqual(spillStart.hours, [{ hour: 23, seconds: 1800 }]);
const spillNext = dayTraining(
  [{ id: "b", started_at: "2026-10-01T23:30:00", ended_at: "2026-10-02T00:30:00", duration_sec: 3600 }],
  "2026-10-02",
);
assert.deepEqual(spillNext.hours, [{ hour: 0, seconds: 1800 }]);

const open = dayTraining(
  [{ id: "c", started_at: "2026-10-01T08:00:00", ended_at: null, duration_sec: null }],
  day,
);
assert.equal(open.seconds, null);
assert.deepEqual(open.hours, []);
assert.equal(open.open, true);
assert.equal(open.durationMissing, false);

const imported = dayTraining(
  [{ id: "d", started_at: "2026-10-01T08:00:00", ended_at: "2026-10-01T08:00:00", duration_sec: null }],
  day,
);
assert.equal(imported.seconds, null);
assert.equal(imported.open, false);
assert.equal(imported.durationMissing, true);

const empty = dayTraining([], day);
assert.equal(empty.seconds, null);
assert.deepEqual(empty.hours, []);

const ignored = dayTraining(
  [
    { id: "e", started_at: "not-a-date", ended_at: "2026-10-01T09:00:00", duration_sec: 600 },
    { id: "f", started_at: "2026-10-01T09:00:00", ended_at: "2026-10-01T09:10:00", duration_sec: 0 },
    null,
  ],
  day,
);
assert.equal(ignored.seconds, null);

const now = new Date(2026, 9, 1, 15, 0, 0);
const week = weekActivity(
  [
    { id: "today", started_at: "2026-10-01T12:00:00", ended_at: "2026-10-01T13:00:00", duration_sec: 3600 },
    { id: "short", started_at: "2026-09-30T12:00:00", ended_at: "2026-09-30T12:30:00", duration_sec: 1800 },
    { id: "rest", started_at: "2026-09-29T12:00:00", ended_at: null, duration_sec: null },
  ],
  now,
);
assert.equal(week.length, 7);
assert.equal(week[6].key, "2026-10-01");
assert.equal(week[6].fill, 1);
assert.equal(week[5].fill, 0.5);
assert.equal(week[4].trained, true);
assert.equal(week[4].seconds, null);
assert.equal(week[4].fill, 0);
assert.equal(week[3].trained, false);

assert.deepEqual(
  workoutIdsOnDay(
    [
      { id: "today", started_at: "2026-10-01T12:00:00" },
      { id: "other", started_at: "2026-09-30T12:00:00" },
      { id: "", started_at: "2026-10-01T13:00:00" },
      { started_at: "2026-10-01T14:00:00" },
    ],
    day,
  ),
  ["today"],
);

assert.deepEqual(
  rollupSets([
    { reps: 5, weight_kg: 100, distance_m: null },
    { reps: 0, weight_kg: 80 },
    { reps: 8, weight_kg: 20, distance_m: 400 },
    { distance_m: 0 },
    { distance_m: -5 },
    null,
  ]),
  { tonnageKg: 660, distanceM: 400 },
);
assert.deepEqual(rollupSets([{ reps: 5 }, { weight_kg: 10 }]), { tonnageKg: null, distanceM: null });
assert.deepEqual(rollupSets([]), { tonnageKg: null, distanceM: null });

const steps = readDailyMetric(
  [
    { metric: "steps", value: 0, recorded_at: "2026-10-01T12:00:00", simulated: false },
    { metric: "steps", value: 9000, recorded_at: "2026-09-30T23:00:00Z", import_day: "2026-10-01", device: "samsung_health", simulated: false },
    { metric: "steps", value: 12000, recorded_at: "2026-10-01T18:00:00", device: "demo", simulated: true },
  ],
  day,
);
assert.deepEqual(steps, { value: 9000, device: "samsung_health", simulated: false });

assert.equal(readDailyMetric([{ value: 4000, recorded_at: "2026-10-02T12:00:00" }], day), null);
assert.equal(readDailyMetric([{ value: "4000", recorded_at: "2026-10-01T12:00:00" }], day), null);
assert.equal(readDailyMetric([], day), null);

const sample = readDailyMetric(
  [{ value: 2200, recorded_at: "2026-10-01T12:00:00", device: "whoop", simulated: true }],
  day,
);
assert.equal(sample?.simulated, true);
assert.equal(sample?.value, 2200);

assert.equal(loggedMinutes(5400), 90);
assert.equal(loggedMinutes(20), null);
assert.equal(loggedMinutes(45), 1);
assert.equal(parseDayKey("2026-10-01", now), "2026-10-01");
assert.equal(parseDayKey("2026-02-31", now), "2026-10-01");
assert.equal(parseDayKey(undefined, now), "2026-10-01");
