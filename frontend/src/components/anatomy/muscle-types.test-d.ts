import type {
  ActivationMap,
  MuscleHeatmapData,
  MuscleSlug,
} from "./muscle-types";

const slug = "chest" satisfies MuscleSlug;
const activation = {
  chest: "primary",
  triceps: "secondary",
} satisfies ActivationMap;
const heatmap = {
  volumes: { chest: 1200 },
  max: 1200,
  muscles: {
    chest: {
      sets_7d: 9,
      volume: 1200,
      load_percent: 100,
      last_trained_at: "2026-09-01T10:00:00Z",
      recovery_state: "recovering",
    },
  },
} satisfies MuscleHeatmapData;

void slug;
void activation;
void heatmap;
