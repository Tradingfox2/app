import assert from "node:assert/strict";
import { progressMessages } from "./progress-locales.ts";

const placeholders = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(",");
const english = Object.keys(progressMessages.fr);
for (const locale of ["fr", "de", "es", "it"] as const) {
  const table = progressMessages[locale];
  assert.deepEqual(Object.keys(table).sort(), [...english].sort(), `${locale} covers every progress string`);
  for (const key of english) {
    assert.equal(placeholders(table[key]), placeholders(key), `${locale}: placeholders of "${key}"`);
    assert.ok(table[key].trim().length > 0, `${locale}: "${key}" is not empty`);
  }
}
console.log(`progress locales ok: ${english.length} strings x 4 languages`);
