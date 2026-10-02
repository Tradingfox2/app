import assert from "node:assert/strict";
import { weeklyReviewDue } from "./weekly-review.ts";

assert.equal(weeklyReviewDue(new Date(2026, 9, 4, 23, 59)), false);
assert.equal(weeklyReviewDue(new Date(2026, 9, 5, 0, 1)), true);
assert.equal(weeklyReviewDue(new Date(2026, 9, 1, 12)), true);
assert.equal(weeklyReviewDue(new Date(2026, 9, 10, 18)), true);
assert.equal(weeklyReviewDue(new Date(2026, 9, 11, 0, 1)), false);
