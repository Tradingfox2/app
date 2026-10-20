import assert from "node:assert/strict";

import { Nutrition } from "./nutrition.ts";

assert.equal(Nutrition.panelLine("", "g"), null);
assert.equal(Nutrition.panelLine("   ", "ml"), null);
assert.equal(Nutrition.loggedAmount(""), null);
assert.equal(Nutrition.loggedAmount("abc"), null);
assert.equal(Nutrition.panelLine("32", "g"), "32 g");
assert.equal(Nutrition.panelLine("350", "ml"), "350 ml");
assert.equal(Nutrition.panelLine("32,5", "g"), "32.5 g");

const blank = { protein: Nutrition.panelLine("", "g"), water: Nutrition.panelLine("", "ml") };
assert.deepEqual(blank, { protein: null, water: null });
assert.notEqual(blank.protein, "0 g");
assert.notEqual(blank.water, "0 ml");

const missing = Nutrition.shownNutrients([
  { key: "proteins", value: 5.2, unit: "g", opinion: null },
  { key: "sugars", value: null, unit: "g", opinion: "sugars" },
  { key: "sodium", unit: "g" },
  { key: "fibre", value: Number.NaN, unit: "g", opinion: "fibre" },
]);
assert.deepEqual(missing.map((row) => row.key), ["proteins"]);
assert.equal(missing.some((row) => row.value === 0), false);

const noFacts = Nutrition.factsToShow({
  ok: true,
  notice: "no_facts",
  nutrients: [
    { key: "sugars", value: 9, unit: "g", opinion: "sugars" },
    { key: "sodium", value: 0.1, unit: "g", opinion: "sodium" },
  ],
});
assert.deepEqual(noFacts, []);

const failed = Nutrition.factsToShow({
  ok: false,
  notice: "lookup_failed",
  nutrients: [{ key: "proteins", value: 0, unit: "g", opinion: null }],
});
assert.deepEqual(failed, []);

const sodium = Nutrition.factsToShow({
  ok: true,
  notice: null,
  nutrients: [{ key: "sodium", value: 0.4, unit: "g", opinion: "sodium" }],
});
assert.equal(sodium[0]?.opinion, "sodium");
assert.equal(sodium[0]?.value, 0.4);

assert.equal(Nutrition.normalizeBarcode("3017 6240 1070 1"), "3017624010701");
assert.equal(Nutrition.normalizeBarcode("3017624010701"), "3017624010701");
assert.equal(Nutrition.normalizeBarcode("nutella"), null);
