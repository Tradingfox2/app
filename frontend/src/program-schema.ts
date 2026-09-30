import { z } from "zod";

export const ProgramExerciseSchema = z.object({
  exercise_slug: z.string(),
  name: z.string(),
  sets: z.number().int().min(1).max(10),
  reps_min: z.number().int().min(1).max(60),
  reps_max: z.number().int().min(1).max(60),
  target_rpe: z.number().min(4).max(10),
  rest_sec: z.number().int().min(15).max(600),
  load_pct_1rm: z.number().min(20).max(105).nullable().optional(),
});

export const ProgramDaySchema = z.object({
  day_index: z.number().int().min(1).max(7),
  focus: z.enum(["push", "pull", "legs", "upper", "lower", "full_body", "conditioning", "rest"]),
  exercises: z.array(ProgramExerciseSchema),
});

export const ProgramWeekSchema = z.object({
  week_index: z.number().int().min(1).max(12),
  phase: z.enum(["accumulation", "intensification", "deload", "peak"]),
  days: z.array(ProgramDaySchema),
});

export const ProgramSchema = z.object({ weeks: z.array(ProgramWeekSchema) });

export type Program = z.infer<typeof ProgramSchema>;
export type ProgramDay = z.infer<typeof ProgramDaySchema>;
export type ProgramExercise = z.infer<typeof ProgramExerciseSchema>;

export const PHASE_LABELS: Record<string, string> = {
  accumulation: "ACCUMULATION",
  intensification: "INTENSIFICATION",
  deload: "DELOAD",
  peak: "PEAK",
};

export const FOCUS_LABELS: Record<string, string> = {
  push: "PUSH",
  pull: "PULL",
  legs: "LEGS",
  upper: "UPPER",
  lower: "LOWER",
  full_body: "FULL BODY",
  conditioning: "CONDITIONING",
  rest: "REST",
};

/** Session title for a program day that is not attached to an existing workout id. */
export function programDayName(focus: string): string {
  return FOCUS_LABELS[focus] ?? focus;
}
