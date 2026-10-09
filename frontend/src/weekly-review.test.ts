import assert from "node:assert/strict";
import { readWeeklyReview, weeklyReviewDue } from "./weekly-review.ts";

assert.equal(weeklyReviewDue(new Date(2026, 9, 4, 23, 59)), false);
assert.equal(weeklyReviewDue(new Date(2026, 9, 5, 0, 1)), true);
assert.equal(weeklyReviewDue(new Date(2026, 9, 1, 12)), true);
assert.equal(weeklyReviewDue(new Date(2026, 9, 10, 18)), true);
assert.equal(weeklyReviewDue(new Date(2026, 9, 11, 0, 1)), false);

const review = {
  iso_week: "2026-W40",
  headline: "Two sessions.",
  wins: "Squats moved.",
  watch: "Load is up.",
  next_week_change: "Keep an easy day.",
};
assert.deepEqual(readWeeklyReview(review), review);
assert.equal(readWeeklyReview([]), null);
assert.equal(readWeeklyReview(null), null);
assert.equal(readWeeklyReview({ headline: "   ", wins: "", watch: "", next_week_change: "" }), null);
assert.equal(readWeeklyReview({ wins: "x", watch: "y", next_week_change: "z" }), null);
