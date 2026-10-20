import assert from "node:assert/strict";
import { PhoneHealthRead } from "./phone-health-read.ts";

const now = new Date(2026, 9, 2, 15, 0, 0);

assert.equal(PhoneHealthRead.dayInsideDefaultHistory("2026-10-02", now), true);
assert.equal(PhoneHealthRead.dayInsideDefaultHistory("2026-09-03", now), true);
assert.equal(PhoneHealthRead.dayInsideDefaultHistory("2026-09-02", now), false);

const bounds = PhoneHealthRead.localDayBounds("2026-10-02");
assert.equal(bounds.start.getDate(), 2);
assert.equal(bounds.start.getHours(), 0);
assert.equal(bounds.end.getDate(), 3);

assert.deepEqual(PhoneHealthRead.interpretSteps("granted", true, 8420), { kind: "value", value: 8420 });
assert.deepEqual(PhoneHealthRead.interpretSteps("granted", true, null), { kind: "empty" });
assert.deepEqual(PhoneHealthRead.interpretSteps("granted", true, 0), { kind: "empty" });
assert.deepEqual(PhoneHealthRead.interpretSteps("denied", true, null), { kind: "hidden" });
assert.deepEqual(PhoneHealthRead.interpretSteps("denied", true, 0), { kind: "hidden" });
assert.deepEqual(PhoneHealthRead.interpretSteps("granted", false, null), { kind: "hidden" });
assert.deepEqual(PhoneHealthRead.interpretSteps("unknown", true, null), { kind: "hidden" });
assert.deepEqual(PhoneHealthRead.interpretSteps("unknown", false, 1200), { kind: "value", value: 1200 });

assert.deepEqual(PhoneHealthRead.interpretHeartRate("denied", true, []), { kind: "hidden" });
assert.deepEqual(PhoneHealthRead.interpretHeartRate("granted", true, []), { kind: "empty" });
assert.deepEqual(PhoneHealthRead.interpretHeartRate("granted", false, []), { kind: "hidden" });
assert.deepEqual(PhoneHealthRead.interpretHeartRate("granted", true, [0, 72, 110]), {
  kind: "value",
  value: { min: 72, max: 110 },
});

assert.deepEqual(PhoneHealthRead.interpretWorkouts("denied", true, []), { kind: "hidden" });
assert.deepEqual(PhoneHealthRead.interpretWorkouts("granted", true, []), { kind: "empty" });
assert.equal(
  PhoneHealthRead.interpretWorkouts("granted", true, [
    { key: "a", label: "Workout", startedAt: "2026-10-02T10:00:00", endedAt: null },
  ]).kind,
  "value",
);
assert.deepEqual(PhoneHealthRead.interpretWorkouts("granted", false, []), { kind: "hidden" });

const server = { value: 100, device: "garmin", simulated: false };
assert.equal(PhoneHealthRead.pickStepReading(server, { kind: "value", value: 9000 }, "Apple Health"), server);
assert.deepEqual(PhoneHealthRead.pickStepReading(null, { kind: "value", value: 9000 }, "Health Connect"), {
  value: 9000,
  device: "Health Connect",
  simulated: false,
});
assert.equal(PhoneHealthRead.pickStepReading(null, { kind: "empty" }, "Apple Health"), null);
assert.equal(PhoneHealthRead.pickStepReading(null, { kind: "hidden" }, "Apple Health"), null);
assert.equal(PhoneHealthRead.pickStepReading(null, { kind: "value", value: 0 }, "Apple Health"), null);
