import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ExerciseThumbMap } from "./exercise-thumb-map.ts";

const exercises = JSON.parse(
  readFileSync(new URL("../../../../tools/exercise-icons/exercises.json", import.meta.url), "utf8"),
) as { slug: string }[];
assert.equal(exercises.length, 217);
for (const e of exercises) assert.ok(ExerciseThumbMap.hasExactIcon(e.slug), `missing icon for ${e.slug}`);

assert.equal(ExerciseThumbMap.keyForExercise("back-squat"), "back-squat");
assert.equal(ExerciseThumbMap.keyForExercise("not-a-real-move", "dumbbell"), "equip-dumbbell");
assert.equal(ExerciseThumbMap.keyForExercise("not-a-real-move", "cable"), "equip-machine");
assert.equal(ExerciseThumbMap.keyForExercise(null, null), "equip-bodyweight");
for (const f of ["push", "pull", "legs", "upper", "lower", "full_body", "conditioning", "rest"]) {
  assert.equal(ExerciseThumbMap.keyForDay(f), `day-${f}`);
}
assert.equal(ExerciseThumbMap.keyForDay("Full Body"), "day-full_body");
assert.equal(ExerciseThumbMap.keyForDay("mystery"), "day-full_body");
assert.equal(ExerciseThumbMap.keyForEquipment("kettlebell"), "equip-kettlebell");

const xml = ExerciseThumbMap.xml("deadlift");
assert.ok(xml.startsWith("<svg") && xml.endsWith("</svg>"));
assert.ok(!xml.includes("~"), "colour tokens must be expanded");
assert.ok(xml.includes("#FF6A3D"), "primary muscle highlight present");
console.log("exercise-thumb-map: ok");
