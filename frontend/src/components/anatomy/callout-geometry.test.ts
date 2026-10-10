import assert from "node:assert/strict";
import {
  BACK_MUSCLES,
  BACK_VIEWBOX,
  FRONT_MUSCLES,
  FRONT_VIEWBOX,
} from "./anatomy-artwork.ts";
import {
  boxesOverlap,
  contoursFor,
  leaderOutsideOwnFill,
  muscleCalloutPlans,
  parseViewBox,
  pointInBox,
  pointInContours,
  readCalloutFacts,
} from "./callout-geometry.ts";
import { MUSCLE_KNOWLEDGE } from "./muscle-knowledge.ts";
import { MUSCLE_HOME_SIDE } from "./muscle-relations.ts";
import { MUSCLE_SLUGS, type MuscleSlug } from "./muscle-types.ts";

const front = muscleCalloutPlans(FRONT_MUSCLES, FRONT_VIEWBOX);
const back = muscleCalloutPlans(BACK_MUSCLES, BACK_VIEWBOX);
const again = muscleCalloutPlans(FRONT_MUSCLES, FRONT_VIEWBOX);

assert.deepEqual(front, again, "callout plans are stable");

function memberBoxes(side: "front" | "back", slug: MuscleSlug) {
  const defs = side === "front" ? FRONT_MUSCLES : BACK_MUSCLES;
  return defs.filter((definition) => definition.slug === slug);
}

for (const slug of MUSCLE_SLUGS) {
  const home = MUSCLE_HOME_SIDE[slug];
  const plans = home === "front" ? front : back;
  const plan = plans.find((item) => item.slug === slug);
  assert.ok(plan, `${slug} has a callout on ${home}`);
  assert.equal(plan.side, home);
  assert.ok(pointInBox(plan.anchor, plan.bbox), `${slug} anchor is inside the union bbox`);
  const members = memberBoxes(home, slug);
  assert.ok(
    members.some((member) => {
      const box = contoursFor([member], slug);
      const bounds = box.length
        ? box.reduce(
            (acc, contour) => {
              for (const point of contour) {
                acc.minX = Math.min(acc.minX, point.x);
                acc.minY = Math.min(acc.minY, point.y);
                acc.maxX = Math.max(acc.maxX, point.x);
                acc.maxY = Math.max(acc.maxY, point.y);
              }
              return acc;
            },
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
          )
        : null;
      return bounds ? pointInBox(plan.anchor, bounds) : false;
    }),
    `${slug} anchor is inside a member region bbox`,
  );
  const own = contoursFor(home === "front" ? FRONT_MUSCLES : BACK_MUSCLES, slug);
  assert.ok(pointInContours(plan.anchor, own), `${slug} anchor is inside the muscle fill`);
  assert.ok(plan.leader.length >= 2, `${slug} leader has an end`);
  assert.deepEqual(plan.leader[0], plan.anchor);
  const defs = home === "front" ? FRONT_MUSCLES : BACK_MUSCLES;
  const others = defs
    .filter((definition) => definition.slug !== slug)
    .flatMap((definition) => contoursFor([definition], definition.slug));
  const crossings = leaderOutsideOwnFill(plan, own, others);
  assert.deepEqual(crossings, [], `${slug} leader stays out of other muscles`);
  assert.notEqual(plan.anchor.x, members[0].labelX, `${slug} does not reuse the path-start label x`);
  assert.equal(plan.gutter, home === "front" ? "left" : "right", `${slug} uses the outer gutter`);
  const frame = parseViewBox(home === "front" ? FRONT_VIEWBOX : BACK_VIEWBOX);
  const extra = 28;
  const minX = plan.gutter === "left" ? frame.minX - extra : frame.minX;
  const maxX = minX + frame.width + extra;
  const end = plan.leader[plan.leader.length - 1];
  assert.ok(
    end.x >= minX && end.x <= maxX && end.y >= frame.minY && end.y <= frame.minY + frame.height,
    `${slug} leader end stays inside the expanded viewBox`,
  );
}

for (const plans of [front, back]) {
  for (const gutter of ["left", "right"] as const) {
    const slots = plans.filter((plan) => plan.gutter === gutter).map((plan) => plan.slot);
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        assert.equal(boxesOverlap(slots[i], slots[j]), false, `slots overlap on ${gutter}`);
      }
    }
  }
}

const both = ["shoulders", "forearms"] as const;
for (const slug of both) {
  const frontPlan = front.find((plan) => plan.slug === slug);
  const backPlan = back.find((plan) => plan.slug === slug);
  assert.ok(frontPlan, `${slug} front`);
  assert.ok(backPlan, `${slug} back`);
  assert.equal(frontPlan.gutter, "left");
  assert.equal(backPlan.gutter, "right");
}

assert.deepEqual(readCalloutFacts(undefined), { role: null, sessions: null, sets: null });
assert.deepEqual(
  readCalloutFacts({ ...MUSCLE_KNOWLEDGE.chest, role: "  ", sessions: [Number.NaN, 2], sets: [1, Number.POSITIVE_INFINITY] }),
  { role: null, sessions: null, sets: null },
);
assert.deepEqual(readCalloutFacts(MUSCLE_KNOWLEDGE.chest).sessions, [2, 3]);
assert.notEqual(readCalloutFacts(MUSCLE_KNOWLEDGE.chest).sessions?.[0], 0);

console.log(`callout geometry ok: ${front.length} front, ${back.length} back`);
