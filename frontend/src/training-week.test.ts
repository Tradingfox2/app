import assert from "node:assert/strict";
import { localDayKey, readTrainingTotals, readWorkoutCount, trainingCalendar } from "./training-week.ts";

const now = new Date(2026, 9, 1, 15, 30, 0);

const days = trainingCalendar(
  [
    { started_at: "2026-10-01T12:00:00" },
    { started_at: "2026-09-29T08:00:00" },
    { started_at: "2026-09-24T12:00:00" },
    { started_at: null },
    { started_at: "not-a-date" },
  ],
  now,
);

assert.deepEqual(
  days.map((day) => day.key),
  ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"],
);
assert.deepEqual(
  days.map((day) => day.trained),
  [false, false, false, false, true, false, true],
);
assert.equal(days[6].isToday, true);
assert.equal(days[0].isToday, false);
assert.equal(localDayKey(now), "2026-10-01");

const totals = readTrainingTotals({
  workouts_this_week: 2,
  training: {
    sets_week: 10,
    tonnage_week_kg: 2400,
    minutes_week: 45,
    muscles_week: ["chest", "back"],
    streak_days: 3,
  },
});
assert.deepEqual(totals, { sets: 10, tonnageKg: 2400, minutes: 45, muscles: 2, streakDays: 3 });
assert.equal(readWorkoutCount({ workouts_this_week: 0 }), 0);
assert.equal(readWorkoutCount({ workouts_this_week: 4.5 }), null);

assert.equal(readTrainingTotals(null), null);
assert.equal(readTrainingTotals([]), null);
assert.equal(readTrainingTotals({ training: {} }), null);
assert.equal(readTrainingTotals({ training: { sets_week: 1, tonnage_week_kg: 0, minutes_week: 0, muscles_week: [], streak_days: 0 } })?.sets, 1);
assert.equal(readWorkoutCount([]), null);
assert.equal(readWorkoutCount({ workouts_this_week: "3" }), null);
