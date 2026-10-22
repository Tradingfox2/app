/** Shapes returned by the progress API (`backend/routers/progress.py`). */
export type LedgerEntry = {
  key: string;
  kind: string;
  xp: number;
  at: string;
  day: string;
  meta: Record<string, any>;
  created_at?: string;
};

export type ProgressStreak = {
  current: number;
  longest: number;
  start: string | null;
  last_day: string | null;
  checked_in_today: boolean;
  at_risk: boolean;
  freezes: number;
  max_freezes: number;
};

export type ProgressBadge = {
  id: string;
  metric: string;
  threshold: number;
  xp: number;
  value: number;
  unlocked_at: string | null;
};

export type ProgressWeek = {
  week: string;
  workouts: number;
  workouts_goal: number;
  active_days: string[];
  active_days_goal: number;
  steps: number;
  steps_goal: number;
  minutes: number;
  xp: number;
};

export type ProgressSummary = {
  xp: number;
  level: number;
  stage: string;
  level_floor: number;
  next_level_xp: number;
  into_level: number;
  level_span: number;
  progress: number;
  streak: ProgressStreak;
  week: ProgressWeek;
  badges: ProgressBadge[];
  counters: Record<string, number>;
  recent: LedgerEntry[];
  frame: string;
  division: string | null;
  celebrations: LedgerEntry[];
};

export type ProgressChallenge = {
  id: string;
  kind: "solo" | "friends" | "club" | "coach";
  title: string;
  metric: "workouts" | "active_days" | "minutes" | "steps" | "xp";
  target: number;
  xp_reward: number;
  starts_at: string;
  ends_at: string;
  joined: boolean;
  value: number;
  progress: number;
  completed: boolean;
  status: "upcoming" | "active" | "ended";
  participants: number;
};

export type LeagueRow = { rank: number; user_id: string; name: string | null; xp: number; zone: string; me: boolean };

export type LeagueView = {
  week: string;
  division?: string | null;
  placed?: boolean;
  opted_out?: boolean;
  ends_at?: string;
  table?: LeagueRow[];
  promote?: number;
  relegate?: number;
  last_result?: { rank: number; outcome: string; division: string; next_division: string; size: number } | null;
};

export type CupRow = { rank: number; community_id: string; name: string | null; score: number; active_members: number; mine?: boolean };
export type CupView = { month: string; ends_at: string; table: CupRow[]; last: { month: string; winner: CupRow | null } | null };

export type RewardsView = {
  frames: { id: string; stage: string; unlocked: boolean }[];
  selected_frame: string;
  pro_credit: { level: number; days: number; unlocked: boolean; granted_days?: number | null }[];
  gym_rewards: { id: string; gym_id: string; code: string; expires_at: string; kind?: string; label?: string }[];
  freezes: { every_days: number; max: number };
};
