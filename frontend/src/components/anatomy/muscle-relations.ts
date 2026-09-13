import type {
  ActivationMap,
  BodySide,
  MuscleRecommendations,
  MuscleSlug,
} from "./muscle-types";

/** Side where a muscle is primarily visible on the athletic figure. */
export const MUSCLE_HOME_SIDE: Record<MuscleSlug, BodySide> = {
  chest: "front",
  back: "back",
  lats: "back",
  shoulders: "front",
  biceps: "front",
  triceps: "back",
  forearms: "front",
  quads: "front",
  hamstrings: "back",
  glutes: "back",
  calves: "back",
  abs: "front",
  obliques: "front",
  lower_back: "back",
};

export const ANTAGONISTS: Record<MuscleSlug, MuscleSlug> = {
  chest: "back",
  back: "chest",
  lats: "chest",
  shoulders: "lats",
  biceps: "triceps",
  triceps: "biceps",
  forearms: "biceps",
  quads: "hamstrings",
  hamstrings: "quads",
  glutes: "quads",
  calves: "quads",
  abs: "lower_back",
  obliques: "lower_back",
  lower_back: "abs",
};

/** Compound partners that typically work with the selected muscle. */
export const SYNERGISTS: Record<MuscleSlug, MuscleSlug[]> = {
  chest: ["shoulders", "triceps"],
  back: ["biceps", "lats"],
  lats: ["biceps", "back"],
  shoulders: ["triceps", "chest"],
  biceps: ["back", "lats", "forearms"],
  triceps: ["chest", "shoulders"],
  forearms: ["biceps"],
  quads: ["glutes", "calves"],
  hamstrings: ["glutes", "lower_back"],
  glutes: ["hamstrings", "quads"],
  calves: ["quads"],
  abs: ["obliques"],
  obliques: ["abs"],
  lower_back: ["glutes", "hamstrings"],
};

export function combinationActivation(muscle: MuscleSlug): ActivationMap {
  const map: ActivationMap = { [muscle]: "primary" };
  for (const partner of SYNERGISTS[muscle]) {
    if (!map[partner]) map[partner] = "secondary";
  }
  const antagonist = ANTAGONISTS[muscle];
  if (!map[antagonist]) map[antagonist] = "stabilizer";
  return map;
}

/** Merge catalog secondaries onto the instant combination map. Selected muscle stays primary. */
export function activationFromRecommendations(
  muscle: MuscleSlug,
  recs: MuscleRecommendations,
): ActivationMap {
  const map = combinationActivation(muscle);
  const pool = [...recs.primary, ...recs.secondary, ...recs.combinations];
  for (const exercise of pool) {
    if (
      exercise.primary_muscle_slug &&
      exercise.primary_muscle_slug !== "cardio" &&
      !map[exercise.primary_muscle_slug]
    ) {
      map[exercise.primary_muscle_slug] = "secondary";
    }
    for (const slug of exercise.secondary_muscle_slugs ?? []) {
      if (!map[slug]) map[slug] = "secondary";
    }
  }
  map[muscle] = "primary";
  return map;
}

/** Muscles drawn on both Front and Back (anterior + posterior heads). */
const BOTH_SIDES: MuscleSlug[] = ["shoulders", "forearms"];

export function isVisibleOnSide(slug: MuscleSlug, side: BodySide): boolean {
  if (BOTH_SIDES.includes(slug)) return true;
  return MUSCLE_HOME_SIDE[slug] === side;
}

export function partnersOnOtherSide(
  muscle: MuscleSlug,
  currentSide: BodySide,
): MuscleSlug[] {
  const map = combinationActivation(muscle);
  return (Object.keys(map) as MuscleSlug[]).filter(
    (slug) => slug !== muscle && !isVisibleOnSide(slug, currentSide),
  );
}
