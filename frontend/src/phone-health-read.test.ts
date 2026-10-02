import assert from "node:assert/strict";
import {
  dayInsideDefaultHistory,
  interpretHeartRate,
  interpretSteps,
  interpretWorkouts,
  localDayBounds,
  pickStepReading,
} from "./phone-health-read.ts";

const now = new Date(2026, 9, 2, 15, 0, 0);

assert.equal(dayInsideDefaultHistory("2026-10-02", now), true);
assert.equal(dayInsideDefaultHistory("2026-09-03", now), true);
assert.equal(dayInsideDefaultHistory("2026-09-02", now), false);

const bounds = localDayBounds("2026-10-02");
assert.equal(bounds.start.getDate(), 2);
assert.equal(bounds.start.getHours(), 0);
assert.equal(bounds.end.getDate(), 3);

assert.deepEqual(interpretSteps("granted", true, 8420), { kind: "value", value: 8420 });
assert.deepEqual(interpretSteps("granted", true, null), { kind: "empty" });
assert.deepEqual(interpretSteps("granted", true, 0), { kind: "empty" });
assert.deepEqual(interpretSteps("denied", true, null), { kind: "hidden" });
assert.deepEqual(interpretSteps("denied", true, 0), { kind: "hidden" });
assert.deepEqual(interpretSteps("granted", false, null), { kind: "hidden" });
assert.deepEqual(interpretSteps("unknown", true, null), { kind: "hidden" });
assert.deepEqual(interpretSteps("unknown", false, 1200), { kind: "value", value: 1200 });

assert.deepEqual(interpretHeartRate("denied", true, []), { kind: "hidden" });
assert.deepEqual(interpretHeartRate("granted", true, []), { kind: "empty" });
assert.deepEqual(interpretHeartRate("granted", false, []), { kind: "hidden" });
assert.deepEqual(interpretHeartRate("granted", true, [0, 72, 110]), {
  kind: "value",
  value: { min: 72, max: 110 },
});

assert.deepEqual(interpretWorkouts("denied", true, []), { kind: "hidden" });
assert.deepEqual(interpretWorkouts("granted", true, []), { kind: "empty" });
assert.equal(
  interpretWorkouts("granted", true, [
    { key: "a", label: "Workout", startedAt: "2026-10-02T10:00:00", endedAt: null },
  ]).kind,
  "value",
);
assert.deepEqual(interpretWorkouts("granted", false, []), { kind: "hidden" });

const server = { value: 100, device: "garmin", simulated: false };
assert.equal(pickStepReading(server, { kind: "value", value: 9000 }, "Apple Health"), server);
assert.deepEqual(pickStepReading(null, { kind: "value", value: 9000 }, "Health Connect"), {
  value: 9000,
  device: "Health Connect",
  simulated: false,
});
assert.equal(pickStepReading(null, { kind: "empty" }, "Apple Health"), null);
assert.equal(pickStepReading(null, { kind: "hidden" }, "Apple Health"), null);
assert.equal(pickStepReading(null, { kind: "value", value: 0 }, "Apple Health"), null);
