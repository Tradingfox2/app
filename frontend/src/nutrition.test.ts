import assert from "node:assert/strict";

import { factsToShow, loggedAmount, normalizeBarcode, panelLine, shownNutrients } from "./nutrition.ts";

assert.equal(panelLine("", "g"), null);
assert.equal(panelLine("   ", "ml"), null);
assert.equal(loggedAmount(""), null);
assert.equal(loggedAmount("abc"), null);
assert.equal(panelLine("32", "g"), "32 g");
assert.equal(panelLine("350", "ml"), "350 ml");
assert.equal(panelLine("32,5", "g"), "32.5 g");

const blank = { protein: panelLine("", "g"), water: panelLine("", "ml") };
assert.deepEqual(blank, { protein: null, water: null });
assert.notEqual(blank.protein, "0 g");
assert.notEqual(blank.water, "0 ml");

const missing = shownNutrients([
  { key: "proteins", value: 5.2, unit: "g", opinion: null },
  { key: "sugars", value: null, unit: "g", opinion: "sugars" },
  { key: "sodium", unit: "g" },
  { key: "fibre", value: Number.NaN, unit: "g", opinion: "fibre" },
]);
assert.deepEqual(missing.map((row) => row.key), ["proteins"]);
assert.equal(missing.some((row) => row.value === 0), false);

const noFacts = factsToShow({
  ok: true,
  notice: "no_facts",
  nutrients: [
    { key: "sugars", value: 9, unit: "g", opinion: "sugars" },
    { key: "sodium", value: 0.1, unit: "g", opinion: "sodium" },
  ],
});
assert.deepEqual(noFacts, []);

const failed = factsToShow({
  ok: false,
  notice: "lookup_failed",
  nutrients: [{ key: "proteins", value: 0, unit: "g", opinion: null }],
});
assert.deepEqual(failed, []);

const sodium = factsToShow({
  ok: true,
  notice: null,
  nutrients: [{ key: "sodium", value: 0.4, unit: "g", opinion: "sodium" }],
});
assert.equal(sodium[0]?.opinion, "sodium");
assert.equal(sodium[0]?.value, 0.4);

assert.equal(normalizeBarcode("3017 6240 1070 1"), "3017624010701");
assert.equal(normalizeBarcode("3017624010701"), "3017624010701");
assert.equal(normalizeBarcode("nutella"), null);
