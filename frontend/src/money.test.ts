import assert from "node:assert/strict";
import { Money } from "./money.ts";

// Intl uses non-breaking spaces; compare with plain ones.
const fmt = (minor: number, currency: string, locale: string) => Money.format(minor, currency, locale).replace(/\s/g, " ");

assert.equal(Money.exponent("EUR"), 2);
assert.equal(Money.exponent("usd"), 2);
assert.equal(Money.exponent("JPY"), 0);
assert.equal(Money.exponent("krw"), 0);
assert.equal(Money.exponent("KWD"), 3);
assert.equal(Money.exponent(""), 2);

assert.equal(Money.toMajor(1050, "EUR"), 10.5);
assert.equal(Money.toMajor(1500, "JPY"), 1500);
assert.equal(Money.toMajor(1500, "KWD"), 1.5);

assert.equal(fmt(1050, "EUR", "en-US"), "€10.50");
assert.equal(fmt(1500, "JPY", "en-US"), "¥1,500");
assert.equal(fmt(1500, "jpy", "en-US"), "¥1,500");
assert.equal(fmt(12345, "KWD", "en-US"), "KWD 12.345");
assert.equal(fmt(0, "USD", "en-US"), "$0.00");
// Locale changes the separators, never the amount.
assert.equal(fmt(123456, "EUR", "de-DE"), "1.234,56 €");

console.log("money: ok");
