/**
 * Coaching knowledge per muscle group: why it matters, a short insight and the
 * weekly training prescription (sessions & hard sets) most lifters respond to.
 *
 * Numbers follow mainstream hypertrophy research (Schoenfeld et al. 2017 on
 * frequency; 10–20 hard sets/week; ~48 h between sessions for the same muscle)
 * and are phrased as general guidance, not medical advice.
 */
import type { MuscleSlug } from "./muscle-types";

export type MuscleKnowledge = {
  /** One-line "what it does" */
  role: string;
  /** Why it is worth training (health + performance) */
  why: string;
  /** Practical coaching insight */
  insight: string;
  /** Sessions per week (min-max) */
  sessions: [number, number];
  /** Hard sets per week (min-max) */
  sets: [number, number];
  /** Recommended rest between sessions of this muscle, in hours */
  restHours: number;
  /** Rep range most efficient for growth */
  reps: string;
};

export const MUSCLE_KNOWLEDGE: Record<MuscleSlug, MuscleKnowledge> = {
  chest: {
    role: "Horizontal pushing, arm adduction.",
    why: "Pressing strength protects the shoulder joint and drives every push you do in daily life and sport.",
    insight: "Grow it with a full stretch at the bottom of presses and flyes; incline work fills in the upper chest.",
    sessions: [2, 3],
    sets: [10, 18],
    restHours: 48,
    reps: "6–12",
  },
  back: {
    role: "Upper-back retraction, scapular control, posture.",
    why: "A strong upper back counters desk posture, stabilises heavy lifts and prevents shoulder impingement.",
    insight: "Balance every push with a row (1:1 volume) and pause each rep with the shoulder blades squeezed.",
    sessions: [2, 3],
    sets: [12, 20],
    restHours: 48,
    reps: "8–15",
  },
  lats: {
    role: "Pulling the arm down and back, spinal stability.",
    why: "Lats give you the V-taper, power pull-ups and rowing, and brace the spine under a barbell.",
    insight: "Drive the elbows to the hips and let the lats stretch fully at the top of every pull-down.",
    sessions: [2, 3],
    sets: [10, 18],
    restHours: 48,
    reps: "6–12",
  },
  shoulders: {
    role: "Overhead pressing and arm raises in every plane.",
    why: "Healthy, strong shoulders are the most injury-prone joint in the gym; balanced deltoids keep them stable.",
    insight: "Side delts respond to high frequency and light loads; keep rear-delt work for posture balance.",
    sessions: [2, 3],
    sets: [10, 20],
    restHours: 36,
    reps: "8–20",
  },
  biceps: {
    role: "Elbow flexion and forearm supination.",
    why: "Biceps assist every pull and protect the elbow tendons that take a beating from rows and chin-ups.",
    insight: "They already work in back day; 6–10 direct sets with a full stretch is plenty for most lifters.",
    sessions: [2, 3],
    sets: [6, 14],
    restHours: 36,
    reps: "8–15",
  },
  triceps: {
    role: "Elbow extension; two-thirds of the upper arm.",
    why: "Locking out presses depends on triceps strength, and they add more arm size than the biceps.",
    insight: "Overhead extensions load the long head in its stretched position, the fastest route to growth.",
    sessions: [2, 3],
    sets: [6, 14],
    restHours: 36,
    reps: "8–15",
  },
  forearms: {
    role: "Grip, wrist flexion and extension.",
    why: "Grip strength is one of the strongest simple predictors of long-term health and limits deadlifts and rows.",
    insight: "Farmer carries and dead hangs train grip functionally; keep wrist curls light and frequent.",
    sessions: [2, 4],
    sets: [4, 10],
    restHours: 24,
    reps: "10–20 / timed holds",
  },
  quads: {
    role: "Knee extension; standing, climbing, jumping.",
    why: "Quad strength preserves knee health and independence with age and produces most of your lower-body power.",
    insight: "Depth matters: full-range squats and split squats grow the quads far more than partials.",
    sessions: [2, 3],
    sets: [10, 18],
    restHours: 48,
    reps: "6–12",
  },
  hamstrings: {
    role: "Knee flexion and hip extension.",
    why: "Strong hamstrings sprint faster and are the main protection against knee (ACL) and hamstring injuries.",
    insight: "Train both jobs: a hinge (RDL) for hip extension and a curl for knee flexion, each week.",
    sessions: [2, 3],
    sets: [8, 16],
    restHours: 48,
    reps: "6–12",
  },
  glutes: {
    role: "Hip extension, abduction and rotation.",
    why: "The body's biggest muscle powers sprints and jumps and takes load off the lower back and knees.",
    insight: "Hip thrusts hit them at full contraction; deep squats and lunges at full stretch. Use both.",
    sessions: [2, 3],
    sets: [8, 16],
    restHours: 48,
    reps: "6–15",
  },
  calves: {
    role: "Ankle plantar flexion; walking and running spring.",
    why: "Calf strength stabilises the ankle, drives running economy and lowers Achilles injury risk.",
    insight: "They recover fast: train them 3× a week with a slow, deep stretch at the bottom of each rep.",
    sessions: [2, 4],
    sets: [8, 16],
    restHours: 24,
    reps: "8–20",
  },
  abs: {
    role: "Spinal flexion and bracing under load.",
    why: "A strong core transfers force between legs and arms and protects the lumbar spine in every heavy lift.",
    insight: "Load them like any muscle (cable crunches, hanging raises) instead of hundreds of unweighted reps.",
    sessions: [2, 3],
    sets: [6, 12],
    restHours: 24,
    reps: "10–20",
  },
  obliques: {
    role: "Trunk rotation and anti-rotation.",
    why: "Obliques resist twisting under load, the movement that most often injures the lower back.",
    insight: "Anti-rotation work (Pallof press, side planks, suitcase carries) beats twisting crunches.",
    sessions: [2, 3],
    sets: [4, 10],
    restHours: 24,
    reps: "10–15 / timed holds",
  },
  lower_back: {
    role: "Spinal extension and isometric bracing.",
    why: "Erector strength is the difference between a bulletproof and a fragile back in daily life and deadlifts.",
    insight: "It already works in squats and hinges; add 2–4 sets of back extensions, and never train it to failure.",
    sessions: [1, 2],
    sets: [4, 8],
    restHours: 72,
    reps: "10–15",
  },
};

export function frequencyLabel(k: MuscleKnowledge): string {
  const [a, b] = k.sessions;
  return a === b ? `${a}×/week` : `${a}–${b}×/week`;
}

export function setsLabel(k: MuscleKnowledge): string {
  const [a, b] = k.sets;
  return `${a}–${b} hard sets/week`;
}

export function restLabel(k: MuscleKnowledge): string {
  return `${k.restHours} h between sessions`;
}
