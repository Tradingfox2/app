import { storage } from "./utils/storage";

const RAW_BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
const BASE = RAW_BASE.replace(/\/$/, "");

export type User = {
  id: string;
  email: string;
  full_name: string | null;
  role: "athlete" | "coach" | "admin";
  avatar_url: string | null;
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
  createWorkout: (title: string, notes?: string) =>
    request<any>("/workouts", { method: "POST", body: JSON.stringify({ title, notes }) }),
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

  coaches: () => request<User[]>("/coaches"),
  relationships: () => request<any[]>("/coach/relationships"),
  requestCoach: (client_email: string) =>
    request<any>("/coach/request", { method: "POST", body: JSON.stringify({ client_email }) }),
  updateRelationship: (id: string, status: string) =>
    request<any>(`/coach/relationships/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  communities: () => request<any[]>("/communities"),
  posts: (community_id?: string) =>
    request<any[]>(`/posts${community_id ? `?community_id=${community_id}` : ""}`),
  createPost: (content: string) =>
    request<any>("/posts", { method: "POST", body: JSON.stringify({ content }) }),

  groupSessions: () => request<any[]>("/group-sessions"),

  currentSub: () => request<any>("/subscriptions/current"),
  setSub: (plan: string) =>
    request<any>("/subscriptions", { method: "POST", body: JSON.stringify({ plan }) }),
  referral: () => request<any>("/referrals/mine"),

  progression: (exerciseId: string) =>
    request<{ series: any[]; pr: any }>(`/progression/${exerciseId}`),
  heatmap: () => request<{ volumes: Record<string, number>; max: number }>("/muscle-heatmap"),
};
