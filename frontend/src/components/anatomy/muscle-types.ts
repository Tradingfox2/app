export const MUSCLE_SLUGS = [
  "chest",
  "back",
  "lats",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "abs",
  "obliques",
  "lower_back",
] as const;

export type MuscleSlug = (typeof MUSCLE_SLUGS)[number];
export type BodySide = "front" | "back";
export type RecoveryState = "ready" | "recovering" | "high_load" | "untrained";
export type ActivationLevel = "primary" | "secondary" | "stabilizer";
export type ActivationMap = Partial<Record<MuscleSlug, ActivationLevel>>;

export type MuscleStats = {
  sets_7d: number;
  volume: number;
  load_percent: number;
  last_trained_at: string | null;
  recovery_state: RecoveryState;
};

export type MuscleHeatmapData = {
  volumes: Partial<Record<MuscleSlug, number>>;
  max: number;
  muscles?: Partial<Record<MuscleSlug, MuscleStats>>;
};

export type RecommendationExercise = {
  slug: string;
  name: string;
  primary_muscle_slug: MuscleSlug | "cardio";
  secondary_muscle_slugs?: MuscleSlug[];
  equipment?: string | null;
  difficulty?: "beginner" | "intermediate" | "advanced";
  category?: string;
  instructions?: string;
  video_url?: string | null;
  video_poster_url?: string | null;
  video_duration_sec?: number | null;
};

export type CircuitItem = {
  exercise_slug: string;
  name?: string;
  sets: number;
  reps_min: number;
  reps_max: number;
  rest_sec: number;
};

export type Circuit = {
  name: string;
  rationale?: string;
  items: CircuitItem[];
};

export type MuscleRecommendations = {
  muscle_slug: MuscleSlug;
  antagonist_slug: MuscleSlug;
  primary: RecommendationExercise[];
  secondary: RecommendationExercise[];
  combinations: RecommendationExercise[];
  circuits: Circuit[];
};

export type AiCircuit = Required<Pick<Circuit, "name" | "items">> & {
  rationale: string;
};

export type AiCircuitRequest = {
  muscle_slug: MuscleSlug;
  goal: "strength" | "hypertrophy" | "endurance" | "fat_loss" | "general";
  level: "beginner" | "intermediate" | "advanced";
  equipment: string[];
};
