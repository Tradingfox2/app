import type { Ionicons } from "@expo/vector-icons";

type Glyph = keyof typeof Ionicons.glyphMap;

/** English source strings; translated through t() at render. */
export const BADGE_LABELS: Record<string, { label: string; icon: Glyph }> = {
  first_workout: { label: "First workout", icon: "barbell" },
  workouts_10: { label: "10 workouts", icon: "barbell" },
  workouts_50: { label: "50 workouts", icon: "barbell" },
  workouts_100: { label: "100 workouts", icon: "barbell" },
  workouts_250: { label: "250 workouts", icon: "barbell" },
  streak_7: { label: "7-day streak", icon: "flame" },
  streak_30: { label: "30-day streak", icon: "flame" },
  streak_100: { label: "100-day streak", icon: "flame" },
  steps_day_10k: { label: "10k steps in a day", icon: "footsteps" },
  steps_total_100k: { label: "100k steps", icon: "footsteps" },
  steps_total_1m: { label: "1 million steps", icon: "footsteps" },
  minutes_1000: { label: "1,000 minutes", icon: "time" },
  first_pr: { label: "First PR", icon: "trending-up" },
  prs_10: { label: "10 PRs", icon: "trending-up" },
  first_gym_checkin: { label: "First gym check-in", icon: "location" },
  gym_checkins_25: { label: "25 gym check-ins", icon: "location" },
  first_challenge: { label: "First challenge", icon: "flag" },
  challenges_5: { label: "5 challenges", icon: "flag" },
  league_promoted: { label: "Promoted", icon: "arrow-up-circle" },
  league_champion: { label: "League champion", icon: "podium" },
  cup_winner: { label: "Cup winner", icon: "trophy" },
  level_10: { label: "Level 10", icon: "star" },
  level_25: { label: "Level 25", icon: "star" },
  level_50: { label: "Level 50", icon: "star" },
};

export const STAGE_LABELS: Record<string, string> = {
  rookie: "Rookie", mover: "Mover", athlete: "Athlete", pro: "Pro", elite: "Elite", legend: "Legend",
};

export const DIVISION_LABELS: Record<string, string> = {
  bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum", diamond: "Diamond",
};

export const DIVISION_COLORS: Record<string, string> = {
  bronze: "#C98B5A", silver: "#C5CCD3", gold: "#E4B15A", platinum: "#8FE0D5", diamond: "#9FC4FF",
};

export const FRAME_COLORS: Record<string, string> = {
  none: "#3A4652", bronze: "#C98B5A", silver: "#C5CCD3", gold: "#E4B15A", neon: "#D6E35A", legend: "#B48CF0",
};

export const METRIC_UNITS: Record<string, string> = {
  workouts: "workouts", active_days: "active days", minutes: "min", steps: "steps", xp: "XP",
};

export const LEDGER_LABELS: Record<string, string> = {
  workout: "Workout", pr: "Personal record", gym_checkin: "Gym check-in", steps_5k: "5k steps day",
  steps_10k: "10k steps day", streak_day: "Streak day", badge: "Badge", challenge: "Challenge completed",
  post: "Post", kudos: "Kudos",
};
