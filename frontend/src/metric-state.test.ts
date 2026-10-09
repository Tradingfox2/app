import assert from "node:assert/strict";
import { metricCaption, measuredNumber, readMeasured, readReadiness } from "./metric-state.ts";
import { colors, textContrastPairs } from "./palette.ts";

assert.deepEqual(readMeasured(undefined), { state: "missing" });
assert.deepEqual(readMeasured(null), { state: "missing" });
assert.deepEqual(readMeasured({}), { state: "missing" });
assert.deepEqual(readMeasured({ value: null }), { state: "missing" });
assert.deepEqual(readMeasured({ value: "0" }), { state: "missing" });
assert.equal(measuredNumber({ value: null }), null);
assert.deepEqual(readMeasured({ value: 0 }), { state: "value", value: 0 });
assert.equal(measuredNumber({ value: 0 }), 0);
assert.equal(measuredNumber({ value: 14.2 }), 14.2);
assert.equal(metricCaption(null, false), "not_connected");
assert.equal(metricCaption(null, true), "not_measured");
assert.equal(metricCaption(0, true), "recorded_zero");
assert.equal(metricCaption(55, false), "measured");

assert.deepEqual(readReadiness(null), { kind: "unavailable" });
assert.deepEqual(readReadiness({}), { kind: "unavailable" });
assert.equal(readReadiness({ readiness: { score: null, verdict: null, confidence: 0, missing: ["hrv"] } }).kind, "unknown");
const scored = readReadiness({ readiness: { score: 0, verdict: "rest", confidence: 1, missing: [] } });
assert.equal(scored.kind, "scored");
if (scored.kind === "scored") assert.equal(scored.score, 0);
const invented = readReadiness({ readiness: { score: 70, verdict: "elite", confidence: 0.5, missing: [] } });
if (invented.kind === "scored") assert.equal(invented.verdict, null);

function channel(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const linear = (part: number) => {
    const unit = part / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(channel(foreground), channel(background));
  const darker = Math.min(channel(foreground), channel(background));
  return (lighter + 0.05) / (darker + 0.05);
}

for (const [foreground, background] of textContrastPairs) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= 4.5, `${foreground} on ${background} is ${ratio.toFixed(2)}, below 4.5`);
}

assert.ok(contrast(colors.textDim, colors.bg) >= 4.5);
assert.ok(contrast(colors.textDim, colors.surface) >= 4.5);
assert.equal(colors.bg, "#101418");
assert.equal(colors.brand, "#D6E35A");

console.log("metric-state contrast pairs", textContrastPairs.length);
