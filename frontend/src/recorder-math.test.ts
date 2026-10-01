import assert from "node:assert/strict";
import {
  appendElevation,
  appendFix,
  emptyElevation,
  emptyTrack,
  formatClock,
  formatPace,
  haversineM,
  paceSecPerKm,
  readStoredActivity,
  recordingBody,
  rebaseElevation,
  routeSketch,
  speedKmh,
  sportProfile,
} from "./recorder-math.ts";

const base = { lat: 48.8566, lng: 2.3522, t: 1_000_000, acc: 8 as number | null };
const north = (meters: number, t: number, acc: number | null = 8) => ({
  lat: base.lat + meters / 111_195,
  lng: base.lng,
  t,
  acc,
});

const step = haversineM(base, north(50, base.t));
assert.ok(Math.abs(step - 50) < 0.2);

let track = emptyTrack();
track = appendFix(track, base, "run");
assert.equal(track.distanceM, null);
track = appendFix(track, north(50, base.t + 10_000), "run");
assert.ok(track.distanceM !== null && Math.abs(track.distanceM - 50) < 0.2);
assert.equal(routeSketch(track.segments).length, 1);
assert.equal(routeSketch(track.segments)[0].length, 2);

let gap = appendFix(emptyTrack(), base, "run");
gap = appendFix(gap, north(50, base.t + 30_000), "run");
assert.equal(gap.distanceM, null);
assert.equal(gap.segments.length, 2);
assert.equal(routeSketch(gap.segments).length, 0);

let jump = appendFix(emptyTrack(), base, "walk");
jump = appendFix(jump, north(400, base.t + 5_000), "walk");
assert.equal(jump.distanceM, null);
assert.equal(jump.segments.length, 1);
assert.equal(jump.segments[0].length, 1);

let paused = appendFix(emptyTrack(), base, "ride");
paused = appendFix(paused, north(30, base.t + 2_000), "ride");
const beforePause = paused.distanceM;
paused = appendFix(paused, north(80, base.t + 4_000), "ride", true);
assert.equal(paused.distanceM, beforePause);
assert.equal(paused.segments.length, 2);
assert.equal(routeSketch(paused.segments).length, 1);

const blurry = appendFix(emptyTrack(), { ...base, acc: 40 }, "walk");
assert.equal(blurry.accepted, 0);
const coarse = appendFix(emptyTrack(), { ...base, acc: 40 }, "hike");
assert.equal(coarse.accepted, 1);
assert.equal(sportProfile("hike").gps, "coarse");
assert.equal(sportProfile("run").display, "pace");
assert.equal(sportProfile("ride").display, "speed");
assert.equal(sportProfile("sail").maxSpeedMps, 20);

let flat = appendElevation(emptyElevation(), 100);
assert.equal(flat.seen, true);
assert.equal(flat.gain, 0);
flat = appendElevation(flat, 100.4);
assert.equal(flat.gain, 0);
flat = appendElevation(flat, 103);
assert.ok(Math.abs(flat.gain - 3) < 0.001);
flat = rebaseElevation(flat);
flat = appendElevation(flat, 140);
assert.ok(Math.abs(flat.gain - 3) < 0.001);

assert.equal(paceSecPerKm(null, 60), null);
assert.equal(speedKmh(null, 60), null);
assert.equal(formatPace(paceSecPerKm(1000, 300) ?? 0), "5:00");
assert.equal(formatClock(65_000), "01:05");
assert.equal(formatClock(3_661_000), "1:01:01");

const body = recordingBody({
  clientId: "client-1234",
  kind: "run",
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_060_000,
  movingSec: 60,
  steps: 0,
  elevationGainM: null,
  track,
});
assert.equal(body.steps, null);
assert.equal(body.elevation_gain_m, null);
assert.equal(body.gps_profile, "fine");
assert.equal("distance_m" in body, false);
assert.equal(body.route.segments.length, 1);

assert.deepEqual(readStoredActivity({ kind: "run", distance_m: 0, steps: 0, moving_sec: 60, has_route: false }), {
  kind: "run",
  distanceM: null,
  movingSec: 60,
  steps: null,
  elevationGainM: null,
  hasRoute: false,
});
assert.equal(readStoredActivity({ kind: "swim" }), null);
