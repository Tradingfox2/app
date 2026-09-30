import { Platform } from "react-native";
import { storage } from "./utils/storage";
import type {
  MuscleHeatmapData,
  MuscleRecommendations,
  MuscleSlug,
  AiCircuit,
  AiCircuitRequest,
} from "./components/anatomy/muscle-types";

const RAW_BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
const BASE = RAW_BASE.replace(/\/$/, "");

export type User = {
  id: string;
  email: string;
  full_name: string | null;
  role: "athlete" | "coach" | "admin";
  coach_status: "not_applied" | "pending" | "approved" | "rejected";
  avatar_url: string | null;
  preferred_locale: SupportedLocale;
  activity_ranking_opt_in?: boolean;
  /** A private account turns incoming follows into requests. */
  is_private?: boolean;
  staff_role?: StaffRole | null;
  bio?: string;
  cover_url?: string | null;
  sports?: string[];
  about?: string;
};

export type StaffRole = "support" | "moderator" | "admin";

export type AdminAccount = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  coach_status: string;
  staff_role: StaffRole | null;
  created_at: string;
  suspended_at: string | null;
  suspended_until: string | null;
  suspension_reason: string | null;
  stats?: { workouts: number; posts: number; communities: number; reports_against: number };
  notes?: { id: string; note: string; author_email: string; created_at: string }[];
};

export type ModerationReport = {
  id: string;
  target_type: "post" | "comment" | "message" | "direct_message" | "user" | "community";
  target_id: string;
  reason: string;
  detail: string;
  content_snapshot: string;
  status: "open" | "resolved";
  resolution: string | null;
  created_at: string;
  reporter: { id: string; full_name: string | null; email: string } | null;
  reported_user: { id: string; full_name: string | null; email: string } | null;
};

export type AuditEntry = {
  id: string;
  actor_email: string | null;
  actor_staff_role: string | null;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminMembership = {
  id: string;
  community_id: string;
  user_id: string;
  status: string;
  created_at: string;
  user: { id: string; full_name: string | null; email: string } | null;
  community: { id: string; name: string; join_policy?: string } | null;
};

export type AdminCommunity = {
  id: string;
  name: string;
  status: string;
  join_policy?: string;
  created_at: string;
  member_count: number;
  pending_count: number;
  owner: { id: string; full_name: string | null; email: string } | null;
};

export type AnalyticsSummary = {
  generated_at: string;
  windows: {
    "24h": Record<string, number>;
    "7d": Record<string, number>;
  };
};

export type AdminOverview = {
  users: { total: number; new_7d: number; suspended: number; coaches: number };
  queues: {
    open_reports: number;
    pending_coach_applications: number;
    pending_memberships: number;
    /**
     * Platform ticket totals. `GET /admin/tickets` returns a page (`count` is that page),
     * so Overview reads these fields instead of summing a list.
     */
    open_tickets?: number;
    pending_tickets?: number;
  };
  activity: { workouts_24h: number; posts_24h: number; messages_24h: number; communities: number };
  permissions: string[];
  staff_role: StaffRole | null;
};

export type SupportTicketStatus = "open" | "pending" | "closed";

/** Account snippet on staff ticket reads. Response-only; not stored on the ticket. */
export type SupportPerson = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export type SupportTicket = {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  status: SupportTicketStatus;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  user: SupportPerson | null;
  assignee: SupportPerson | null;
};

export type SupportMessage = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_role: "user" | "staff";
  body: string;
  media_id: string | null;
  created_at: string;
  /** Present on staff thread reads. Null when that account is gone. */
  author?: SupportPerson | null;
};

export type SupportTicketDetail = SupportTicket & { messages: SupportMessage[] };

/** Staff queue. `count` is the number of rows in `tickets` (the page), not a second total. */
export type SupportTicketList = {
  tickets: SupportTicket[];
  count: number;
};

export type SupportedLocale = "fr" | "en" | "de" | "es" | "it";

/** Member support tickets. Bearer auth, same `/api` prefix as the rest of the client. */
export const TICKET_CATEGORIES = ["billing", "account", "bug", "feature", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Statuses stored by the ticket handlers. There is no priority field. */
export const TICKET_STATUSES = ["open", "pending", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** `GET /tickets` caps `limit` at 100. The list screen asks for that maximum. */
export const TICKET_LIST_LIMIT = 100;

export type TicketSummary = {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  status: string;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TicketAuthorRole = "user" | "staff";

export type TicketMessage = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_role: TicketAuthorRole;
  body: string;
  media_id?: string | null;
  created_at: string;
};

export type Ticket = TicketSummary & {
  messages?: TicketMessage[];
};

export function isTicketCategory(value: string): value is TicketCategory {
  return (TICKET_CATEGORIES as readonly string[]).includes(value);
}

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

export type Membership = {
  id: string;
  community_id: string;
  user_id: string;
  role: "owner" | "moderator" | "member";
  status: "pending" | "active" | "rejected" | "left" | "banned" | "removed";
  entitlement_source: "ownership" | "free" | "payment" | "invite";
  /** While in the future the member can read but not post. */
  timeout_until?: string | null;
  /** Set once the member has seen the welcome message and accepted the rules. */
  onboarded_at?: string | null;
  /** Custom roles assigned on top of the legacy `role` string. */
  role_ids?: string[];
  joined_at: string | null;
  user?: Pick<User, "id" | "full_name" | "avatar_url">;
};

export type Community = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string;
  is_public: boolean;
  join_policy: "open" | "approval" | "paid";
  price_cents: number;
  currency: string;
  member_count: number;
  owner: Pick<User, "id" | "full_name" | "avatar_url"> | null;
  membership: Membership | null;
  created_at: string;
  category?: CommunityCategory;
  rules?: string[];
  welcome_message?: string;
  cover_url?: string | null;
  avatar_url?: string | null;
  status?: "active" | "archived";
};

export const COMMUNITY_CATEGORIES = [
  "strength", "bodybuilding", "powerlifting", "crossfit", "running", "cycling",
  "yoga", "mobility", "calisthenics", "weight_loss", "nutrition", "combat", "general",
] as const;
export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number];

export type ChannelKind = "text" | "announcement" | "program" | "challenge" | "checkin" | "live";

export type CommunityChannel = {
  id: string;
  community_id: string;
  name: string;
  description: string;
  is_default: boolean;
  ranking_opt_in?: boolean;
  kind?: ChannelKind;
  overwrites?: ChannelOverwrite[];
  challenge?: ChallengeSettings | null;
  /** Caller's effective mask for this channel, resolved server-side. */
  permissions?: number;
  /** Other people's messages since the caller last read it, capped at 100. */
  unread_count?: number;
  /** Sidebar group heading. */
  category?: string | null;
  position?: number | null;
  /** Seconds between a member's messages; 0 or absent is off. */
  slowmode_sec?: number;
};

export type CommunityInvite = {
  id: string;
  code: string;
  community_id: string;
  created_by: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  skip_approval: boolean;
  revoked_at: string | null;
  created_at: string;
  unusable_reason: "revoked" | "expired" | "exhausted" | null;
};

export type InvitePreview = {
  code: string;
  unusable_reason: CommunityInvite["unusable_reason"];
  skip_approval: boolean;
  membership_status: Membership["status"] | null;
  /** Null when a dead link points at a private community. */
  community: {
    id: string; name: string; description: string;
    join_policy: Community["join_policy"]; is_public: boolean; member_count: number;
  } | null;
};

export type SearchPerson = MentionedUser & { is_private: boolean; follow_state: FollowState };
export type SearchKind = "users" | "communities" | "posts" | "tags";
export type SearchTag = { tag: string; posts: number };

export type ChannelOverwrite = { role_id: string; allow: number; deny: number };

export type ChallengeMetric = "workouts" | "active_days" | "minutes" | "tonnage";
export type ChallengeSettings = { metric: ChallengeMetric; starts_at: string; ends_at: string; goal?: number | null };

export type Streak = { current: number; longest: number; total: number; checked_in_today: boolean; last_day: string | null };
export type CheckinBoard = {
  channel_id: string; today: string; me: Streak;
  leaders: (Streak & { user_id: string; user: MentionedUser | null })[];
};

export type ChallengeBoard = {
  channel_id: string;
  challenge: ChallengeSettings;
  status: "upcoming" | "active" | "ended";
  participant_count: number;
  joined: boolean;
  me: { place: number; score: number } | null;
  leaders: { place: number; user_id: string; score: number; user: MentionedUser | null }[];
  group_total: number;
  goal_progress: number | null;
};

export type CommunityRole = {
  id: string;
  community_id: string;
  name: string;
  color: string;
  rank: number;
  permissions: number;
  is_default: boolean;
};

export type MessageReaction = { emoji: string; user_ids: string[] };

export type MentionedUser = Pick<User, "id" | "full_name" | "avatar_url">;

/** `none` -> can follow, `pending` -> request sent, `following` -> accepted. */
export type FollowState = "none" | "pending" | "following";

export type Connection = MentionedUser & { followed_by_me: boolean };

export type FollowRequest = {
  id?: string;
  follower_id: string;
  followee_id: string;
  status: "pending";
  created_at: string;
  follower: MentionedUser | null;
};

export type PublicProfile = MentionedUser & {
  followers: number;
  following: number;
  posts: number;
  follow_state: FollowState;
  followed_by_me: boolean;
  is_private: boolean;
  is_blocked: boolean;
  is_muted: boolean;
  can_view_posts: boolean;
  can_message: boolean;
  bio?: string;
  is_coach?: boolean;
  cover_url?: string | null;
  sports?: string[];
  /** Empty when the viewer cannot see this person's wall. */
  about?: string;
};

export type AppNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  /** Everyone who triggered this row; >1 when the event aggregated. */
  actor_ids?: string[];
  actor_count?: number;
  actors?: MentionedUser[];
  read_at: string | null;
  created_at: string;
};

export type CommunityMessage = {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author: Pick<User, "id" | "full_name" | "avatar_url"> | null;
  reactions?: MessageReaction[];
  reply_to_id?: string | null;
  reply_to?: { id: string; author_id: string; content: string; author?: MentionedUser | null } | null;
  pinned_at?: string | null;
  edited_at?: string | null;
  /** Display names for the <@id> tokens in `content`, resolved server-side. */
  mentions?: MentionedUser[];
  media?: MediaItem[];
  /** The author's most senior role, shown as a coloured tag. */
  author_role?: { name: string; color: string | null } | null;
  /** Present on a message that shares a training program. */
  program?: ProgramSnapshot | null;
  /** Present on the message that announced a live session. */
  live_session_id?: string | null;
};

export type ProgramSnapshot = {
  program_id: string;
  goal: string | null;
  level: string | null;
  days_per_week: number | null;
  weeks_count: number;
  equipment: string[];
  weeks: { week_index: number; phase: string; days: { day_index: number; focus: string; exercises: { name: string; sets: number; reps_min: number; reps_max: number }[] }[] }[];
};

export type SharedProgram = CommunityMessage & { adoption_count: number; adopted_by_me: boolean };

export type LiveSession = {
  id: string;
  channel_id: string;
  community_id: string;
  host_id: string;
  host: MentionedUser | null;
  title: string;
  description: string;
  starts_at: string;
  duration_min: number;
  join_url: string | null;
  status: "scheduled" | "live" | "ended" | "cancelled";
  started_at: string | null;
  ended_at: string | null;
  rsvp_count: number;
  rsvped: boolean;
  /** Centrifugo channel for the in-app room, `live:{id}`. */
  realtime_channel?: string;
};

export type LiveParticipant = {
  user_id: string;
  joined_at: string;
  user: MentionedUser | null;
};

export type LiveRoom = {
  session: LiveSession;
  participants: LiveParticipant[];
  realtime_channel: string;
  /** Centrifugo subscription JWT when realtime is configured; otherwise null. */
  subscription_token: string | null;
  joined: boolean;
};

export type LiveChatMessage = {
  id: string;
  session_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author: MentionedUser | null;
};

export type CommunityInsights = {
  members: number;
  joined_7d: number;
  joined_30d: number;
  left_30d: number;
  pending: number;
  messages_7d: number;
  messages_30d: number;
  active_members_7d: number;
  engagement_rate_7d: number;
  daily_messages: { day: string; messages: number }[];
  top_channels: { id: string; name: string; messages: number }[];
};

export type CommunityAuditEntry = {
  id: string;
  actor_id: string;
  actor: MentionedUser | null;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type CommunityReport = {
  id: string;
  target_type: ModerationReport["target_type"];
  target_id: string;
  reason: string;
  detail: string;
  content_snapshot: string;
  status: "open" | "resolved";
  resolution: string | null;
  created_at: string;
  reported_user: MentionedUser | null;
};

export type NotificationPrefs = { push: boolean; types: Record<string, boolean> };

export type CoachApplication = {
  id?: string;
  status: "not_applied" | "pending" | "approved" | "rejected";
  bio?: string;
  specialties?: string[];
  credentials?: string[];
  review_note?: string | null;
};

export type AdminCoach = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  coach_status: string | null;
  suspended_at: string | null;
  application_id: string | null;
  bio: string | null;
  specialties: string[];
  credentials: string[];
  review_note: string | null;
  created_at: string | null;
};

export type CoachApplicationReview = {
  id: string;
  user_id: string;
  bio: string;
  specialties: string[];
  credentials: string[];
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  created_at: string;
  applicant: (Pick<User, "id" | "full_name" | "avatar_url"> & { email?: string }) | null;
};

export type PartnerDashboard = {
  community_count: number;
  active_members: number;
  pending_members: number;
  payout_status: string;
  balances: { _id: string; gross_cents: number; net_cents: number }[];
  communities: Community[];
};

export type MediaItem = { id: string; kind: "image" | "video"; url: string };

export type Post = {
  id: string;
  author_id: string;
  author: Pick<User, "id" | "full_name" | "avatar_url"> | null;
  content: string;
  community_id: string | null;
  media: MediaItem[];
  repost_of: string | null;
  original?: (Post & { unavailable?: boolean }) | null;
  like_count: number;
  comment_count: number;
  repost_count: number;
  liked_by_me: boolean;
  reposted_by_me: boolean;
  workout_id?: string | null;
  /** Frozen at share time — editing the log later does not change the card. */
  workout_summary?: WorkoutSummary | null;
  status?: string;
  created_at: string;
  saved_by_me?: boolean;
  mentions?: MentionedUser[];
  /** Your own post, still inside the 24-hour edit window. */
  can_edit?: boolean;
  tags?: string[];
  poll?: Poll | null;
  link_preview?: LinkPreview | null;
  edited_at?: string | null;
  /** Missing on older posts; the server treats that as public. */
  audience?: "public" | "friends" | "only_me";
};

export type Poll = {
  options: string[];
  closes_at: string;
  closed: boolean;
  my_vote: number | null;
  total: number;
  /** Hidden (null) until you vote or the poll closes. */
  counts: number[] | null;
};

export type LinkPreview = { url: string; title: string; description: string; image_url: string | null; site_name: string };

export type Story = {
  id: string;
  author_id: string;
  author: MentionedUser | null;
  caption: string;
  media: MediaItem[];
  workout_id: string | null;
  workout_summary: WorkoutSummary | null;
  audience: "public" | "friends" | "only_me";
  highlight: boolean;
  highlight_title: string | null;
  expires_at: string | null;
  created_at: string;
};

export type StoryGroup = { author: MentionedUser | null; stories: Story[] };

export type ProfilePhoto = { post_id: string; id: string; url: string; kind: "image" };

export type WorkoutSummary = {
  workout_id: string;
  title: string;
  duration_sec: number | null;
  sets: number;
  tonnage_kg: number;
  exercises: string[];
  exercise_count: number;
  perceived_effort: number | null;
  ended_at: string;
};

export type PostComment = {
  id: string;
  status?: string;
  post_id: string;
  author_id: string;
  author: Pick<User, "id" | "full_name" | "avatar_url"> | null;
  content: string;
  created_at: string;
  /** Replies point at a top-level comment; threads are one level deep. */
  parent_id?: string | null;
  like_count?: number;
  reply_count?: number;
  liked_by_me?: boolean;
  can_edit?: boolean;
  mentions?: MentionedUser[];
  edited_at?: string | null;
};

export type DirectMessage = {
  id: string;
  thread_key?: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  read_at: string | null;
  created_at: string;
  media?: MediaItem[];
  status?: "active" | "deleted";
};

export type DmThread = {
  peer: Pick<User, "id" | "full_name" | "avatar_url"> | null;
  last_message: DirectMessage;
  unread: number;
};

export type LabMeasurement = {
  type: "numeric" | "bounded" | "qualitative" | "text" | "absent" | string;
  numeric?: number;
  bounded?: { operator: "lt" | "gt" | string; value: number };
  qualitative?: { text: string };
  text?: string;
  absent_reason?: string | null;
  units?: string;
  ucum_code?: string;
};

export type LabMarker = {
  marker_slug: string;
  canonical_key?: string | null;
  marker: string;
  raw_name: string;
  value: number | null;
  bound_operator?: string | null;
  unit: string;
  loinc_code?: string | null;
  interpretation_flag?: string | null;
  measurement?: LabMeasurement;
};

export type LabInterpretation = {
  summary: string[];
  trends: { marker_slug: string; direction: "up" | "down" | "stable"; comment: string }[];
  flags: { marker_slug: string; severity: string; comment: string }[];
};

export type LabReport = {
  id: string;
  filename?: string | null;
  mime: string;
  provider?: "terra" | "ironflow" | string;
  status: "processing" | "done" | "failed" | string;
  step: string;
  markers: LabMarker[];
  markers_count: number;
  interpretation?: LabInterpretation | null;
  interpretation_error?: string | null;
  interpretation_provider?: string | null;
  interpretation_model?: string | null;
  interpretation_locale?: SupportedLocale;
  disclaimer: string;
  requires_professional_review: boolean;
  error?: string | null;
  terra_sessions?: {
    session_id: string;
    report_type?: string;
    report_date?: string;
    report_locale?: string;
    results_count: number;
  }[];
};

export type BiomarkerSeries = {
  slug: string;
  name: string;
  unit: string;
  ref_low?: number | null;
  ref_high?: number | null;
  latest: number;
  points: { date: string; value: number }[];
};

const TOKEN_KEY = "ironflow_token";

export const auth = {
  async getToken(): Promise<string | null> {
    return (await storage.secureGet(TOKEN_KEY, null)) as string | null;
  },
  async setToken(t: string): Promise<void> {
    await storage.secureSet(TOKEN_KEY, t);
  },
  async clearToken(): Promise<void> {
    await storage.secureRemove(TOKEN_KEY);
  },
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await auth.getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.detail || `Request failed: ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return body as T;
}

export type UploadFile = { uri: string; name: string; mimeType: string };

async function upload<T>(path: string, file: UploadFile): Promise<T> {
  const token = await auth.getToken();
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(file.uri)).blob();
    form.append("file", blob, file.name);
  } else {
    form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as any);
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail || `Upload failed: ${res.status}`);
  return body as T;
}

export function mediaUrl(url: string): string {
  return url.startsWith("/") ? `${BASE}${url}` : url;
}

export const api = {
  register: (email: string, password: string, full_name: string, role: string) =>
    request<{ access_token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, full_name, role }),
    }),
  login: (email: string, password: string) =>
    request<{ access_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>("/auth/me"),
  updateProfile: (preferred_locale: SupportedLocale) =>
    request<User>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ preferred_locale }),
    }),
  updateRankingPreference: (activity_ranking_opt_in: boolean) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify({ activity_ranking_opt_in }) }),
  updatePrivacy: (is_private: boolean) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify({ is_private }) }),
  updateProfileDetails: (body: {
    full_name?: string; bio?: string; about?: string; sports?: string[];
    avatar_media_id?: string; remove_avatar?: boolean;
    cover_media_id?: string; remove_cover?: boolean;
  }) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify(body) }),

  dashboard: () => request<any>("/dashboard"),
  /** Same document as dashboard, named for the home screen. */
  homeToday: () => request<any>("/home/today"),

  previousSets: (exerciseId: string, limit = 1) =>
    request<{ exercise_id: string; sessions: { workout_id: string; started_at: string; ended_at: string; sets: Record<string, unknown>[] }[] }>(
      `/exercises/${encodeURIComponent(exerciseId)}/previous-sets?limit=${limit}`,
    ),
  exercises: (params?: { category?: string; muscle?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.muscle) qs.set("muscle", params.muscle);
    const s = qs.toString();
    return request<any[]>(`/exercises${s ? `?${s}` : ""}`);
  },
  muscles: () => request<any[]>("/muscles"),

  workouts: () => request<any[]>("/workouts"),
  workout: (id: string) => request<any>(`/workouts/${id}`),
  createWorkout: (title: string, notes?: string, planned_exercise_slugs: string[] = []) =>
    request<any>("/workouts", {
      method: "POST",
      body: JSON.stringify({ title, notes, planned_exercise_slugs }),
    }),
  planExercises: (workoutId: string, exercise_slugs: string[]) =>
    request<any>(`/workouts/${workoutId}/plan`, {
      method: "POST",
      body: JSON.stringify({ exercise_slugs }),
    }),
  finishWorkout: (id: string) => request<any>(`/workouts/${id}/finish`, { method: "POST" }),
  repeatWorkout: (id: string) => request<any>(`/workouts/${id}/repeat`, { method: "POST" }),
  listSets: (workoutId: string) => request<any[]>(`/workouts/${workoutId}/sets`),
  addSet: (workoutId: string, payload: any) =>
    request<any>(`/workouts/${workoutId}/sets`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  biomarkers: () => request<any[]>("/biomarkers"),
  addBiomarker: (payload: any) =>
    request<any>("/biomarkers", { method: "POST", body: JSON.stringify(payload) }),

  wearable: (metric?: string) =>
    request<any[]>(`/wearable-metrics${metric ? `?metric=${metric}` : ""}`),
  addWearable: (payload: any) =>
    request<any>("/wearable-metrics", { method: "POST", body: JSON.stringify(payload) }),

  coaches: () => request<(User & { community_count: number; member_count: number })[]>("/coaches"),
  relationships: () => request<any[]>("/coach/relationships"),
  requestCoach: (client_email: string) =>
    request<any>("/coach/request", { method: "POST", body: JSON.stringify({ client_email }) }),
  updateRelationship: (id: string, status: string) =>
    request<any>(`/coach/relationships/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  communities: (scope: "discover" | "mine" = "discover", options: { category?: CommunityCategory | null; offset?: number } = {}) =>
    request<Community[]>(`/communities?scope=${scope}${options.category ? `&category=${options.category}` : ""}${options.offset ? `&offset=${options.offset}` : ""}`),
  archivedCommunities: () => request<Community[]>("/communities-archived"),
  restoreCommunity: (id: string) => request<Community>(`/communities/${id}/restore`, { method: "POST" }),
  transferCommunity: (id: string, memberId: string) =>
    request<Community>(`/communities/${id}/transfer`, { method: "POST", body: JSON.stringify({ member_id: memberId }) }),
  completeOnboarding: (id: string) => request<void>(`/communities/${id}/onboarding`, { method: "POST" }),
  communityAuditLog: (id: string) => request<CommunityAuditEntry[]>(`/communities/${id}/audit-log`),
  communityInsights: (id: string) => request<CommunityInsights>(`/communities/${id}/insights`),
  communityReports: (id: string, status: "open" | "resolved" = "open") =>
    request<CommunityReport[]>(`/communities/${id}/reports?status=${status}`),
  reviewCommunityReport: (id: string, reportId: string, resolution: "dismissed" | "content_removed", note = "") =>
    request<CommunityReport>(`/communities/${id}/reports/${reportId}`, { method: "PATCH", body: JSON.stringify({ resolution, note }) }),
  timeoutMember: (communityId: string, memberId: string, minutes: number) =>
    request<Membership>(`/communities/${communityId}/members/${memberId}/timeout`, { method: "POST", body: JSON.stringify({ minutes }) }),
  reorderChannels: (communityId: string, channelIds: string[]) =>
    request<{ channel_ids: string[] }>(`/communities/${communityId}/channel-order`, { method: "PUT", body: JSON.stringify({ channel_ids: channelIds }) }),
  community: (id: string) => request<Community>(`/communities/${id}`),
  createCommunity: (payload: {
    name: string;
    slug: string;
    description: string;
    category?: CommunityCategory;
    is_public: boolean;
    join_policy: Community["join_policy"];
    price_cents: number;
    currency: string;
  }) => request<Community>("/communities", { method: "POST", body: JSON.stringify(payload) }),
  joinCommunity: (id: string) =>
    request<Membership>(`/communities/${id}/join`, { method: "POST" }),
  communityCheckout: (id: string, inviteCode?: string) =>
    request<{ url: string }>(`/communities/${id}/checkout`, { method: "POST", body: JSON.stringify({ invite_code: inviteCode ?? null }) }),
  leaveCommunity: (id: string) =>
    request<void>(`/communities/${id}/membership`, { method: "DELETE" }),
  communityMembers: (id: string, options: { q?: string; status?: Membership["status"] } = {}) => {
    const qs = new URLSearchParams();
    if (options.q) qs.set("q", options.q);
    if (options.status) qs.set("status", options.status);
    const suffix = qs.toString();
    return request<Membership[]>(`/communities/${id}/members${suffix ? `?${suffix}` : ""}`);
  },
  reviewCommunityMember: (communityId: string, memberId: string, status: string) =>
    request<Membership>(`/communities/${communityId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  communityChannels: (id: string) =>
    request<CommunityChannel[]>(`/communities/${id}/channels`),
  /** `kind` and `challenge` are only sent when set, so a plain text channel's body is unchanged. */
  createCommunityChannel: (communityId: string, name: string, description = "", options: { kind?: ChannelKind; challenge?: ChallengeSettings; category?: string; slowmode_sec?: number } = {}) =>
    request<CommunityChannel>(`/communities/${communityId}/channels`, {
      method: "POST",
      body: JSON.stringify({
        name, description,
        ...(options.kind && options.kind !== "text" ? { kind: options.kind } : {}),
        ...(options.challenge ? { challenge: options.challenge } : {}),
        ...(options.category ? { category: options.category } : {}),
        ...(options.slowmode_sec ? { slowmode_sec: options.slowmode_sec } : {}),
      }),
    }),
  sharedPrograms: (channelId: string) => request<SharedProgram[]>(`/channels/${channelId}/programs`),
  shareProgram: (channelId: string, programId: string, note = "") =>
    request<CommunityMessage>(`/channels/${channelId}/programs`, { method: "POST", body: JSON.stringify({ program_id: programId, note }) }),
  adoptProgram: (messageId: string) => request<{ id: string }>(`/messages/${messageId}/adopt-program`, { method: "POST" }),
  liveSessions: (channelId: string) => request<{ upcoming: LiveSession[]; past: LiveSession[] }>(`/channels/${channelId}/live-sessions`),
  scheduleLiveSession: (channelId: string, body: { title: string; description?: string; starts_at: string; duration_min?: number; join_url?: string | null }) =>
    request<LiveSession>(`/channels/${channelId}/live-sessions`, { method: "POST", body: JSON.stringify(body) }),
  rsvpLive: (sessionId: string) => request<LiveSession>(`/live-sessions/${sessionId}/rsvp`, { method: "POST" }),
  cancelRsvp: (sessionId: string) => request<LiveSession>(`/live-sessions/${sessionId}/rsvp`, { method: "DELETE" }),
  startLive: (sessionId: string) => request<LiveSession>(`/live-sessions/${sessionId}/start`, { method: "POST" }),
  endLive: (sessionId: string) => request<LiveSession>(`/live-sessions/${sessionId}/end`, { method: "POST" }),
  cancelLive: (sessionId: string) => request<void>(`/live-sessions/${sessionId}`, { method: "DELETE" }),
  liveSession: (sessionId: string) => request<LiveRoom>(`/live-sessions/${sessionId}`),
  joinLive: (sessionId: string) => request<LiveRoom>(`/live-sessions/${sessionId}/join`, { method: "POST" }),
  liveMessages: (sessionId: string) => request<LiveChatMessage[]>(`/live-sessions/${sessionId}/messages`),
  sendLiveMessage: (sessionId: string, content: string) =>
    request<LiveChatMessage>(`/live-sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ content }) }),
  channelTyping: (channelId: string) => request<void>(`/channels/${channelId}/typing`, { method: "POST" }),
  searchChannel: (channelId: string, q: string) =>
    request<CommunityMessage[]>(`/channels/${channelId}/search?q=${encodeURIComponent(q)}`),
  checkinBoard: (channelId: string) => request<CheckinBoard>(`/channels/${channelId}/checkins`),
  challengeBoard: (channelId: string) => request<ChallengeBoard>(`/channels/${channelId}/challenge`),
  joinChallenge: (channelId: string) =>
    request<{ joined: boolean }>(`/channels/${channelId}/challenge/participants`, { method: "POST" }),
  leaveChallenge: (channelId: string) =>
    request<void>(`/channels/${channelId}/challenge/participants`, { method: "DELETE" }),
  channel: (id: string) => request<CommunityChannel>(`/channels/${id}`),
  channelMessages: (id: string, before?: string) =>
    request<CommunityMessage[]>(`/channels/${id}/messages${before ? `?before=${before}` : ""}`),
  updateChannelRanking: (id: string, ranking_opt_in: boolean) =>
    request<CommunityChannel>(`/channels/${id}/ranking`, { method: "PATCH", body: JSON.stringify({ ranking_opt_in }) }),
  updateCommunity: (id: string, body: Partial<Pick<Community, "name" | "description" | "is_public" | "join_policy" | "price_cents" | "currency" | "category" | "rules" | "welcome_message">> & { cover_media_id?: string; avatar_media_id?: string }) =>
    request<Community>(`/communities/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  archiveCommunity: (id: string) => request<void>(`/communities/${id}`, { method: "DELETE" }),
  updateChannel: (channelId: string, body: { name?: string; description?: string; category?: string; slowmode_sec?: number }) =>
    request<CommunityChannel>(`/channels/${channelId}`, { method: "PATCH", body: JSON.stringify(body) }),
  archiveChannel: (channelId: string) => request<void>(`/channels/${channelId}`, { method: "DELETE" }),
  coachApplications: (status: "pending" | "approved" | "rejected" = "pending") =>
    request<CoachApplicationReview[]>(`/admin/coach-applications?status=${status}`),
  adminCoaches: (status: "pending" | "approved" | "rejected" | "suspended") =>
    request<AdminCoach[]>(`/admin/coaches?status=${status}`),
  reviewCoachApplication: (id: string, status: "approved" | "rejected", review_note?: string) =>
    request<CoachApplicationReview>(`/admin/coach-applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, review_note: review_note ?? null }),
    }),
  memberDirectory: (communityId: string, q?: string) =>
    request<MentionedUser[]>(`/communities/${communityId}/directory${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  markChannelRead: (channelId: string, messageId: string) =>
    request<{ channel_id: string; last_read_at: string }>(`/channels/${channelId}/read`, {
      method: "POST", body: JSON.stringify({ message_id: messageId }),
    }),
  createInvite: (communityId: string, body: { max_uses?: number | null; expires_in_hours?: number | null; skip_approval?: boolean }) =>
    request<CommunityInvite>(`/communities/${communityId}/invites`, { method: "POST", body: JSON.stringify(body) }),
  communityInvites: (communityId: string) => request<CommunityInvite[]>(`/communities/${communityId}/invites`),
  revokeInvite: (code: string) => request<void>(`/invites/${code}`, { method: "DELETE" }),
  previewInvite: (code: string) => request<InvitePreview>(`/invites/${code}`),
  redeemInvite: (code: string) => request<Membership>(`/invites/${code}/redeem`, { method: "POST" }),
  searchUsers: (q: string) =>
    request<{ type: "users"; results: SearchPerson[] }>(`/search?type=users&q=${encodeURIComponent(q)}`),
  searchCommunities: (q: string) =>
    request<{ type: "communities"; results: Community[] }>(`/search?type=communities&q=${encodeURIComponent(q)}`),
  searchPosts: (q: string) =>
    request<{ type: "posts"; results: Post[] }>(`/search?type=posts&q=${encodeURIComponent(q)}`),
  searchTags: (q: string) =>
    request<{ type: "tags"; results: SearchTag[] }>(`/search?type=tags&q=${encodeURIComponent(q)}`),
  communityRoles: (id: string) => request<CommunityRole[]>(`/communities/${id}/roles`),
  createRole: (id: string, body: { name: string; color?: string; rank?: number; permissions?: number }) =>
    request<CommunityRole>(`/communities/${id}/roles`, { method: "POST", body: JSON.stringify(body) }),
  updateRole: (roleId: string, body: Partial<Pick<CommunityRole, "name" | "color" | "rank" | "permissions">>) =>
    request<CommunityRole>(`/roles/${roleId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRole: (roleId: string) => request<void>(`/roles/${roleId}`, { method: "DELETE" }),
  assignMemberRoles: (communityId: string, memberId: string, role_ids: string[]) =>
    request<Membership>(`/communities/${communityId}/members/${memberId}/roles`, {
      method: "PUT",
      body: JSON.stringify({ role_ids }),
    }),
  setChannelOverwrites: (channelId: string, overwrites: ChannelOverwrite[]) =>
    request<CommunityChannel>(`/channels/${channelId}/overwrites`, {
      method: "PUT",
      body: JSON.stringify(overwrites),
    }),

  addReaction: (messageId: string, emoji: string) =>
    request<CommunityMessage>(`/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    }),
  removeReaction: (messageId: string, emoji: string) =>
    request<CommunityMessage>(`/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`, {
      method: "DELETE",
    }),
  editMessage: (messageId: string, content: string) =>
    request<CommunityMessage>(`/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteMessage: (messageId: string) => request<void>(`/messages/${messageId}`, { method: "DELETE" }),
  pinMessage: (messageId: string) => request<CommunityMessage>(`/messages/${messageId}/pin`, { method: "POST" }),
  unpinMessage: (messageId: string) => request<void>(`/messages/${messageId}/pin`, { method: "DELETE" }),
  channelPins: (channelId: string) => request<CommunityMessage[]>(`/channels/${channelId}/pins`),
  notifications: (unreadOnly = false, before?: string) =>
    request<AppNotification[]>(`/notifications?unread_only=${unreadOnly}${before ? `&before=${before}` : ""}`),
  deleteNotification: (id: string) => request<void>(`/notifications/${id}`, { method: "DELETE" }),
  clearReadNotifications: () => request<{ deleted: number }>("/notifications", { method: "DELETE" }),
  notificationPreferences: () => request<NotificationPrefs>("/notifications/preferences"),
  updateNotificationPreferences: (body: { push?: boolean; types?: Record<string, boolean> }) =>
    request<NotificationPrefs>("/notifications/preferences", { method: "PUT", body: JSON.stringify(body) }),
  registerPushToken: (token: string, platform: "ios" | "android" | "web") =>
    request<{ registered: boolean }>("/push-tokens", { method: "POST", body: JSON.stringify({ token, platform }) }),
  unregisterPushToken: (token: string, platform: "ios" | "android" | "web") =>
    request<void>("/push-tokens", { method: "DELETE", body: JSON.stringify({ token, platform }) }),
  unreadNotificationCount: () => request<{ count: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) =>
    request<AppNotification>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () =>
    request<{ updated: number }>("/notifications/read-all", { method: "POST" }),
  realtimeToken: () => request<{ enabled: boolean; token: string | null; url: string | null }>("/realtime/token"),
  realtimeSubscriptionToken: (channel: string) =>
    request<{ enabled: boolean; token: string | null }>(`/realtime/subscription-token?channel=${encodeURIComponent(channel)}`),

  /** `media_ids` is only sent when set, so a plain message's body is unchanged. */
  createChannelMessage: (id: string, content: string, reply_to_id?: string | null, media_ids?: string[]) =>
    request<CommunityMessage>(`/channels/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, reply_to_id: reply_to_id ?? null, ...(media_ids?.length ? { media_ids } : {}) }),
    }),
  coachApplication: () => request<CoachApplication>("/coach/application"),
  applyToCoach: (bio: string, specialties: string[], credentials: string[]) =>
    request<CoachApplication>("/coach/applications", {
      method: "POST",
      body: JSON.stringify({ bio, specialties, credentials }),
    }),
  partnerDashboard: () => request<PartnerDashboard>("/partner/dashboard"),
  communityRankings: () =>
    request<{
      communities: Pick<Community, "id" | "name" | "member_count">[];
      coaches: { coach: Community["owner"]; community_count: number; member_count: number }[];
      users: { id: string; full_name: string | null; avatar_url: string | null; active_days: number }[];
      channels: { id: string; name: string; community_id: string; community_name: string; contributors: number }[];
      window_days: number;
    }>("/community-rankings"),
  // Social feed
  feed: (scope: "all" | "following" | "mine" | "friends" = "all", before?: string, filters: { author_id?: string; tag?: string; community_id?: string } = {}) => {
    const qs = new URLSearchParams({ scope });
    if (before) qs.set("before", before);
    for (const [key, value] of Object.entries(filters)) if (value) qs.set(key, value);
    return request<Post[]>(`/feed?${qs.toString()}`);
  },
  getPost: (id: string) => request<Post>(`/posts/${id}`),
  editPost: (id: string, content: string) =>
    request<Post>(`/posts/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  savePost: (id: string) => request<{ saved: boolean }>(`/posts/${id}/save`, { method: "POST" }),
  unsavePost: (id: string) => request<{ saved: boolean }>(`/posts/${id}/save`, { method: "DELETE" }),
  savedPosts: (before?: string) => request<Post[]>(`/saved${before ? `?before=${before}` : ""}`),
  vote: (id: string, option: number) =>
    request<Post>(`/posts/${id}/vote`, { method: "POST", body: JSON.stringify({ option }) }),
  trendingTags: () => request<{ tag: string; posts: number }[]>("/tags/trending"),
  undoRepost: (id: string) => request<void>(`/posts/${id}/repost`, { method: "DELETE" }),
  editComment: (id: string, content: string) =>
    request<PostComment>(`/comments/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteComment: (id: string) => request<void>(`/comments/${id}`, { method: "DELETE" }),
  likeComment: (id: string) => request<{ liked: boolean; like_count: number }>(`/comments/${id}/like`, { method: "POST" }),
  unlikeComment: (id: string) => request<{ liked: boolean; like_count: number }>(`/comments/${id}/like`, { method: "DELETE" }),
  /** Omit `workout_id` entirely when unset: the publish body is asserted exactly in e2e. */
  publish: (payload: { content: string; media_ids?: string[]; community_id?: string | null; workout_id?: string; poll?: { options: string[]; duration_hours: number }; audience?: "public" | "friends" | "only_me" }) =>
    request<Post>("/posts", { method: "POST", body: JSON.stringify(payload) }),
  deletePost: (id: string) => request<void>(`/posts/${id}`, { method: "DELETE" }),
  likePost: (id: string) => request<{ liked: boolean; like_count: number }>(`/posts/${id}/like`, { method: "POST" }),
  unlikePost: (id: string) => request<{ liked: boolean; like_count: number }>(`/posts/${id}/like`, { method: "DELETE" }),
  /** With text it is a quote post; without, a plain repost. */
  repost: (id: string, content?: string) =>
    request<Post>(`/posts/${id}/repost`, { method: "POST", ...(content ? { body: JSON.stringify({ content }) } : {}) }),
  comments: (id: string, before?: string) => request<PostComment[]>(`/posts/${id}/comments${before ? `?before=${before}` : ""}`),
  /** `parent_id` is only sent for a reply, so a top-level comment's body is unchanged. */
  addComment: (id: string, content: string, parentId?: string | null) =>
    request<PostComment>(`/posts/${id}/comments`, { method: "POST", body: JSON.stringify({ content, ...(parentId ? { parent_id: parentId } : {}) }) }),
  uploadMedia: (file: UploadFile) => upload<MediaItem>("/media", file),
  /** Returns `state: "pending"` when the target account is private. */
  follow: (userId: string) =>
    request<{ state: FollowState; user_id: string; following: boolean }>(`/users/${userId}/follow`, { method: "POST" }),
  /** Also withdraws a pending request — one control, both meanings. */
  unfollow: (userId: string) =>
    request<{ state: FollowState; user_id: string; following: boolean }>(`/users/${userId}/follow`, { method: "DELETE" }),
  publicProfile: (userId: string) => request<PublicProfile>(`/users/${userId}/profile`),
  profilePhotos: (userId: string) => request<ProfilePhoto[]>(`/users/${userId}/photos`),
  userStories: (userId: string) => request<Story[]>(`/users/${userId}/stories`),
  userHighlights: (userId: string) => request<Story[]>(`/users/${userId}/highlights`),
  storyFeed: () => request<StoryGroup[]>("/stories/feed"),
  createStory: (body: { workout_id: string; caption?: string; media_ids?: string[]; audience?: "public" | "friends" | "only_me"; highlight?: boolean; highlight_title?: string }) =>
    request<Story>("/stories", { method: "POST", body: JSON.stringify(body) }),
  deleteStory: (id: string) => request<void>(`/stories/${id}`, { method: "DELETE" }),

  followRequests: () => request<FollowRequest[]>("/follow-requests"),
  approveFollowRequest: (followerId: string) =>
    request<{ state: FollowState; follower_id: string }>(`/follow-requests/${followerId}/approve`, { method: "POST" }),
  denyFollowRequest: (followerId: string) =>
    request<void>(`/follow-requests/${followerId}`, { method: "DELETE" }),

  followers: (userId: string) => request<Connection[]>(`/users/${userId}/followers`),
  followingList: (userId: string) => request<Connection[]>(`/users/${userId}/following`),

  blockUser: (userId: string) => request<{ blocked: boolean }>(`/users/${userId}/block`, { method: "POST" }),
  unblockUser: (userId: string) => request<void>(`/users/${userId}/block`, { method: "DELETE" }),
  muteUser: (userId: string) => request<{ muted: boolean }>(`/users/${userId}/mute`, { method: "POST" }),
  unmuteUser: (userId: string) => request<void>(`/users/${userId}/mute`, { method: "DELETE" }),
  dmThreads: () => request<DmThread[]>("/dm"),
  dmMessages: (peerId: string, before?: string) => request<DirectMessage[]>(`/dm/${peerId}/messages${before ? `?before=${before}` : ""}`),
  sendDm: (peerId: string, content: string, media_ids?: string[]) =>
    request<DirectMessage>(`/dm/${peerId}/messages`, { method: "POST", body: JSON.stringify({ content, ...(media_ids?.length ? { media_ids } : {}) }) }),
  deleteDm: (messageId: string) => request<void>(`/dm/messages/${messageId}`, { method: "DELETE" }),
  dmTyping: (peerId: string) => request<void>(`/dm/${peerId}/typing`, { method: "POST" }),
  dmUnreadCount: () => request<{ count: number }>("/dm/unread-count"),
  importSamsungHealth: (file: UploadFile) =>
    upload<{ synced: number; files: number; metrics: string[]; from: string; to: string }>("/wearables/sources/samsung_health/import", file),

  // Moderation + back office
  report: (payload: { target_type: ModerationReport["target_type"]; target_id: string; reason: string; detail?: string }) =>
    request<ModerationReport>("/reports", { method: "POST", body: JSON.stringify(payload) }),
  adminOverview: () => request<AdminOverview>("/admin/overview"),
  adminUsers: (q: string, status: "all" | "active" | "suspended" | "staff") =>
    request<{ users: AdminAccount[]; count: number }>(`/admin/users?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  adminUser: (id: string) => request<AdminAccount>(`/admin/users/${id}`),
  adminAddNote: (id: string, note: string) =>
    request<unknown>(`/admin/users/${id}/notes`, { method: "POST", body: JSON.stringify({ note }) }),
  adminSuspend: (id: string, reason: string, days?: number) =>
    request<AdminAccount>(`/admin/users/${id}/suspend`, { method: "POST", body: JSON.stringify({ reason, days }) }),
  adminReinstate: (id: string, reason: string) =>
    request<AdminAccount>(`/admin/users/${id}/reinstate`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminSetStaffRole: (id: string, staff_role: StaffRole | null, reason: string) =>
    request<AdminAccount>(`/admin/users/${id}/staff-role`, { method: "PATCH", body: JSON.stringify({ staff_role, reason }) }),
  adminReports: (status: "open" | "resolved" = "open") => request<ModerationReport[]>(`/admin/reports?status=${status}`),
  adminTickets: (status: SupportTicketStatus, q = "") =>
    request<SupportTicketList>(`/admin/tickets?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  adminTicket: (id: string) => request<SupportTicketDetail>(`/admin/tickets/${id}`),
  adminUpdateTicket: (id: string, patch: { status?: SupportTicketStatus; assignee_id?: string | null }) =>
    request<SupportTicketDetail>(`/admin/tickets/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  adminReplyTicket: (id: string, body: string) =>
    request<SupportMessage>(`/admin/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
  adminMemberships: (status: "pending" | "banned" | "removed" = "pending") =>
    request<AdminMembership[]>(`/admin/memberships?status=${status}`),
  adminReviewMembership: (id: string, status: "active" | "rejected", reason: string) =>
    request<AdminMembership>(`/admin/memberships/${id}`, { method: "PATCH", body: JSON.stringify({ status, reason }) }),
  adminCommunities: () => request<AdminCommunity[]>("/admin/communities"),
  adminReviewReport: (id: string, resolution: string, note: string) =>
    request<ModerationReport>(`/admin/reports/${id}`, { method: "PATCH", body: JSON.stringify({ resolution, note }) }),
  adminAuditLog: () => request<AuditEntry[]>("/admin/audit-log"),
  adminAnalytics: () => request<AnalyticsSummary>("/admin/analytics"),
  /** Authenticated product-event ingest. `track` in `./analytics` is the caller. */
  ingestEvents: (body: {
    name: string;
    props?: Record<string, string | boolean | null>;
    session_id?: string;
    event_id?: string;
  }) => request<{ accepted: number; duplicates: number }>("/events", {
    method: "POST",
    body: JSON.stringify(body),
  }),

  groupSessions: () => request<any[]>("/group-sessions"),

  currentSub: () => request<any>("/subscriptions/current"),
  setSub: (plan: string) =>
    request<any>("/subscriptions", { method: "POST", body: JSON.stringify({ plan }) }),
  referral: () => request<any>("/referrals/mine"),

  progression: (exerciseId: string) =>
    request<{ series: any[]; pr: any }>(`/progression/${exerciseId}`),
  heatmap: () => request<MuscleHeatmapData>("/muscle-heatmap"),

  muscleRecommendations: (
    muscle: MuscleSlug,
    equipment: string[] = [],
    level?: string,
  ) => {
    const query = new URLSearchParams();
    equipment.forEach((item) => query.append("equipment", item));
    if (level) query.set("level", level);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<MuscleRecommendations>(
      `/muscles/${muscle}/recommendations${suffix}`,
    );
  },

  regenerateMuscleCircuit: (payload: AiCircuitRequest) =>
    request<AiCircuit>("/coach/muscle-circuit", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Adaptive programming engine
  generateProgram: (payload: {
    goal: string;
    level: string;
    days_per_week: number;
    equipment: string[];
    weeks_count: number;
  }) => request<any>("/coach/generate", { method: "POST", body: JSON.stringify(payload) }),
  adjustProgram: (program_id: string, week_index?: number, day_index?: number) =>
    request<any>("/coach/adjust", {
      method: "POST",
      body: JSON.stringify({ program_id, week_index, day_index }),
    }),
  programs: () => request<any[]>("/programs"),
  startProgramDay: (programId: string, body: { week_index?: number; day_index?: number } = {}) =>
    request<any>(`/programs/${encodeURIComponent(programId)}/start-day`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  coachStatus: () =>
    request<{
      provider: string;
      model: string;
      connected: boolean;
      ollama_reachable: boolean;
      ollama_models: string[];
      configured: { anthropic: boolean; openrouter: boolean; ollama: boolean };
    }>("/coach/status"),
  ollamaModels: () => request<{ base_url: string; models: string[] }>("/coach/models/ollama"),
  // One personalised coaching sentence per day (fast model, cached server-side)
  coachTip: () =>
    request<{ date: string; source: string; tip: string; focus: string }>("/coach/tip"),

  // Daily did-you-know tips (5-10, stable per user per day)
  dailyTips: (count = 7) =>
    request<{
      date: string;
      tips: { id: string; category: string; title: string; body: string }[];
    }>(`/tips/daily?count=${count}`),

  // Lab reports pipeline
  labReports: () => request<LabReport[]>("/labs/reports"),
  labReport: (id: string) => request<LabReport>(`/labs/reports/${id}`),
  biomarkersGrouped: () => request<BiomarkerSeries[]>("/biomarkers/grouped"),
  uploadLab: async (file: { uri: string; name: string; mimeType: string }) => {
    const token = await auth.getToken();
    const form = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(file.uri)).blob();
      form.append("file", blob, file.name);
    } else {
      form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as any);
    }
    const res = await fetch(`${BASE}/api/labs/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.detail || `Upload failed: ${res.status}`);
    return body;
  },

  // Wearable sources + gym check-ins
  wearableSources: () => request<any[]>("/wearables/sources"),
  connectSource: (provider: string) =>
    request<any>(`/wearables/sources/${provider}/connect`, { method: "POST" }),
  disconnectSource: (provider: string) =>
    request<any>(`/wearables/sources/${provider}/disconnect`, { method: "POST" }),
  syncSource: (provider: string) =>
    request<any>(`/wearables/sources/${provider}/sync`, { method: "POST" }),
  gyms: () => request<any[]>("/gyms"),
  gymCheckin: (qr_payload: string, workout_id?: string) =>
    request<any>("/gyms/checkin", {
      method: "POST",
      body: JSON.stringify({ qr_payload, workout_id }),
    }),
  gymVisits: () => request<any[]>("/gyms/visits"),

  tickets: (params?: { status?: TicketStatus; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<TicketSummary[]>(`/tickets${query ? `?${query}` : ""}`);
  },
  ticket: (id: string) => request<Ticket>(`/tickets/${encodeURIComponent(id)}`),
  createTicket: (payload: { subject: string; category: TicketCategory; body?: string; media_id?: string | null }) =>
    request<Ticket>("/tickets", { method: "POST", body: JSON.stringify(payload) }),
  addTicketMessage: (id: string, payload: { body: string; media_id?: string | null }) =>
    request<TicketMessage>(`/tickets/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
