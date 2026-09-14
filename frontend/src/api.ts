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
  target_type: "post" | "comment" | "message" | "user" | "community";
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

export type AdminOverview = {
  users: { total: number; new_7d: number; suspended: number; coaches: number };
  queues: { open_reports: number; pending_coach_applications: number; pending_memberships: number };
  activity: { workouts_24h: number; posts_24h: number; messages_24h: number; communities: number };
  permissions: string[];
  staff_role: StaffRole | null;
};

export type SupportedLocale = "fr" | "en" | "de" | "es" | "it";

export type Membership = {
  id: string;
  community_id: string;
  user_id: string;
  role: "owner" | "moderator" | "member";
  status: "pending" | "active" | "rejected" | "left" | "banned";
  entitlement_source: "ownership" | "free" | "payment";
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
};

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
  /** Caller's effective mask for this channel, resolved server-side. */
  permissions?: number;
  /** Other people's messages since the caller last read it, capped at 100. */
  unread_count?: number;
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
  community: {
    id: string; name: string; description: string;
    join_policy: Community["join_policy"]; is_public: boolean; member_count: number;
  };
};

export type SearchPerson = MentionedUser & { is_private: boolean; follow_state: FollowState };
export type SearchKind = "users" | "communities" | "posts";

export type ChannelOverwrite = { role_id: string; allow: number; deny: number };

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
  reply_to?: { id: string; author_id: string; content: string } | null;
  pinned_at?: string | null;
  edited_at?: string | null;
  /** Display names for the <@id> tokens in `content`, resolved server-side. */
  mentions?: MentionedUser[];
};

export type CoachApplication = {
  id?: string;
  status: "not_applied" | "pending" | "approved" | "rejected";
  bio?: string;
  specialties?: string[];
  credentials?: string[];
  review_note?: string | null;
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
};

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
};

export type DirectMessage = {
  id: string;
  thread_key?: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  read_at: string | null;
  created_at: string;
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

  dashboard: () => request<any>("/dashboard"),

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

  communities: (scope: "discover" | "mine" = "discover") =>
    request<Community[]>(`/communities?scope=${scope}`),
  community: (id: string) => request<Community>(`/communities/${id}`),
  createCommunity: (payload: {
    name: string;
    slug: string;
    description: string;
    is_public: boolean;
    join_policy: Community["join_policy"];
    price_cents: number;
    currency: string;
  }) => request<Community>("/communities", { method: "POST", body: JSON.stringify(payload) }),
  joinCommunity: (id: string) =>
    request<Membership>(`/communities/${id}/join`, { method: "POST" }),
  leaveCommunity: (id: string) =>
    request<void>(`/communities/${id}/membership`, { method: "DELETE" }),
  communityMembers: (id: string) => request<Membership[]>(`/communities/${id}/members`),
  reviewCommunityMember: (communityId: string, memberId: string, status: string) =>
    request<Membership>(`/communities/${communityId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  communityChannels: (id: string) =>
    request<CommunityChannel[]>(`/communities/${id}/channels`),
  createCommunityChannel: (communityId: string, name: string, description = "") =>
    request<CommunityChannel>(`/communities/${communityId}/channels`, {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  channel: (id: string) => request<CommunityChannel>(`/channels/${id}`),
  channelMessages: (id: string, before?: string) =>
    request<CommunityMessage[]>(`/channels/${id}/messages${before ? `?before=${before}` : ""}`),
  updateChannelRanking: (id: string, ranking_opt_in: boolean) =>
    request<CommunityChannel>(`/channels/${id}/ranking`, { method: "PATCH", body: JSON.stringify({ ranking_opt_in }) }),
  updateCommunity: (id: string, body: Partial<Pick<Community, "name" | "description" | "is_public" | "join_policy" | "price_cents" | "currency">>) =>
    request<Community>(`/communities/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  archiveCommunity: (id: string) => request<void>(`/communities/${id}`, { method: "DELETE" }),
  updateChannel: (channelId: string, body: { name?: string; description?: string }) =>
    request<CommunityChannel>(`/channels/${channelId}`, { method: "PATCH", body: JSON.stringify(body) }),
  archiveChannel: (channelId: string) => request<void>(`/channels/${channelId}`, { method: "DELETE" }),
  coachApplications: (status: "pending" | "approved" | "rejected" = "pending") =>
    request<CoachApplicationReview[]>(`/admin/coach-applications?status=${status}`),
  reviewCoachApplication: (id: string, status: "approved" | "rejected", review_note?: string) =>
    request<CoachApplicationReview>(`/admin/coach-applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, review_note: review_note ?? null }),
    }),
  memberDirectory: (communityId: string) => request<MentionedUser[]>(`/communities/${communityId}/directory`),
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
  notifications: (unreadOnly = false) =>
    request<AppNotification[]>(`/notifications${unreadOnly ? "?unread_only=true" : ""}`),
  unreadNotificationCount: () => request<{ count: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) =>
    request<AppNotification>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () =>
    request<{ updated: number }>("/notifications/read-all", { method: "POST" }),
  realtimeToken: () => request<{ enabled: boolean; token: string | null; url: string | null }>("/realtime/token"),

  createChannelMessage: (id: string, content: string, reply_to_id?: string | null) =>
    request<CommunityMessage>(`/channels/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, reply_to_id: reply_to_id ?? null }),
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
  posts: (community_id?: string) =>
    request<any[]>(`/posts${community_id ? `?community_id=${community_id}` : ""}`),
  createPost: (content: string, community_id?: string) =>
    request<any>("/posts", { method: "POST", body: JSON.stringify({ content, community_id }) }),

  // Social feed
  feed: (scope: "all" | "following" | "mine" = "all", before?: string) =>
    request<Post[]>(`/feed?scope=${scope}${before ? `&before=${before}` : ""}`),
  /** Omit `workout_id` entirely when unset: the publish body is asserted exactly in e2e. */
  publish: (payload: { content: string; media_ids?: string[]; community_id?: string | null; workout_id?: string }) =>
    request<Post>("/posts", { method: "POST", body: JSON.stringify(payload) }),
  deletePost: (id: string) => request<void>(`/posts/${id}`, { method: "DELETE" }),
  likePost: (id: string) => request<{ liked: boolean; like_count: number }>(`/posts/${id}/like`, { method: "POST" }),
  unlikePost: (id: string) => request<{ liked: boolean; like_count: number }>(`/posts/${id}/like`, { method: "DELETE" }),
  repost: (id: string) => request<Post>(`/posts/${id}/repost`, { method: "POST" }),
  comments: (id: string) => request<PostComment[]>(`/posts/${id}/comments`),
  addComment: (id: string, content: string) =>
    request<PostComment>(`/posts/${id}/comments`, { method: "POST", body: JSON.stringify({ content }) }),
  uploadMedia: (file: UploadFile) => upload<MediaItem>("/media", file),
  /** Returns `state: "pending"` when the target account is private. */
  follow: (userId: string) =>
    request<{ state: FollowState; user_id: string; following: boolean }>(`/users/${userId}/follow`, { method: "POST" }),
  /** Also withdraws a pending request — one control, both meanings. */
  unfollow: (userId: string) =>
    request<{ state: FollowState; user_id: string; following: boolean }>(`/users/${userId}/follow`, { method: "DELETE" }),
  publicProfile: (userId: string) => request<PublicProfile>(`/users/${userId}/profile`),

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
  dmMessages: (peerId: string) => request<DirectMessage[]>(`/dm/${peerId}/messages`),
  sendDm: (peerId: string, content: string) =>
    request<DirectMessage>(`/dm/${peerId}/messages`, { method: "POST", body: JSON.stringify({ content }) }),
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
  adminReviewReport: (id: string, resolution: string, note: string) =>
    request<ModerationReport>(`/admin/reports/${id}`, { method: "PATCH", body: JSON.stringify({ resolution, note }) }),
  adminAuditLog: () => request<AuditEntry[]>("/admin/audit-log"),

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
};
