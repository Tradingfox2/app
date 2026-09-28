import assert from "node:assert/strict";
import { profileTextPatch } from "./profile-patch.ts";

const stored = {
  full_name: "Me One",
  bio: "Powerlifter",
  about: "Morning lifter",
  sports: ["Squat", "Run"],
};

const renamed = profileTextPatch(stored, { ...stored, full_name: "Me Renamed" });
assert.deepEqual(renamed, { full_name: "Me Renamed" });

const cleared = profileTextPatch(stored, { ...stored, about: "  ", sports: [] });
assert.deepEqual(cleared, { about: "", sports: [] });

const untouched = profileTextPatch(
  { full_name: "Me One", bio: "", about: "", sports: [] },
  { full_name: "Me One", bio: "", about: "", sports: [] },
);
assert.deepEqual(untouched, {});
